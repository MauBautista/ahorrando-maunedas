"""Daily mirror and photo copy, weekly dump (07 §10), after BACKUP_HOUR local time; outcomes go in /work info.

Each job keeps its own day mark, so a failed one is retried without repeating the others.
"""

import asyncio
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from maunedas_agent import log
from maunedas_agent.api import ApiError
from maunedas_agent.backup import Mirror, SchemaMismatch, dump, rotate
from maunedas_agent.context import AgentContext
from maunedas_agent.store import now_ms

PAGE_LIMIT = 200
# A first copy of a few thousand rows takes a handful of pages; this only stops a runaway.
MAX_PAGES = 1000
MIRROR_DAY_KEY = "backup_mirror_day"
DUMP_DAY_KEY = "backup_dump_day"
PHOTOS_DAY_KEY = "backup_photos_day"
PHOTOS_TRIED_KEY = "backup_photos_tried_at"
STATUS_KEY = "backup_status"
# rclone against R2 is not retried more often than this after a failure.
PHOTOS_RETRY_MS = 3_600_000
PHOTOS_TIMEOUT_S = 3600
NO_CREDENTIALS = "sin credenciales de R2"

logger = log.get("backup")


def status(ctx: AgentContext) -> dict[str, Any] | None:
    raw = ctx.store.get(STATUS_KEY)
    return json.loads(raw) if raw else None


def _save(ctx: AgentContext, **changes: Any) -> None:
    ctx.store.put(STATUS_KEY, json.dumps({**(status(ctx) or {}), **changes}, separators=(",", ":")))


def _failed(ctx: AgentContext, job: str, e: Exception, **extra: Any) -> None:
    ctx.last_error = f"backup: {e}"
    _save(ctx, **{f"{job}_ok": False, f"{job}_error": str(e)[:300]}, **extra)
    logger.warning(f"{job}_failed", error=str(e))


async def mirror_once(ctx: AgentContext) -> int:
    """Pulls until has_more is false; returns the rows written. Each page is applied with its cursors."""
    settings = ctx.settings
    mirror = Mirror(settings.data_dir / "backups" / "mirror.sqlite", settings.migrations_dir)
    try:
        written = 0
        for _ in range(MAX_PAGES):
            page = await ctx.api.backup_pull({"cursors": mirror.cursors(), "limit": PAGE_LIMIT})
            written += mirror.apply(page)
            if not page["has_more"]:
                return written
        raise RuntimeError(f"el espejo no terminó en {MAX_PAGES} páginas")
    finally:
        mirror.close()


def _rclone_env(ctx: AgentContext) -> dict[str, str]:
    """rclone's remote `r2` from the environment; the keys reach the child process only, never a log."""
    s = ctx.settings
    return {
        **os.environ,
        "RCLONE_CONFIG_R2_TYPE": "s3",
        "RCLONE_CONFIG_R2_PROVIDER": "Cloudflare",
        "RCLONE_CONFIG_R2_ENDPOINT": s.r2_endpoint,
        "RCLONE_CONFIG_R2_ACCESS_KEY_ID": s.r2_access_key_id,
        "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY": s.r2_secret_access_key.get_secret_value(),
        # A read-only token cannot create the bucket.
        "RCLONE_CONFIG_R2_NO_CHECK_BUCKET": "true",
    }


async def photos_once(ctx: AgentContext) -> int:
    """`rclone sync r2:<bucket> /data/backups/r2`; returns the files in the copy (RF-BAK-03)."""
    s = ctx.settings
    target = s.data_dir / "backups" / "r2"
    target.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "rclone",
        "sync",
        f"r2:{s.r2_bucket}",
        str(target),
        "--fast-list",
        "--transfers",
        "4",
        env=_rclone_env(ctx),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout=PHOTOS_TIMEOUT_S)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise
    if proc.returncode != 0:
        last = err.decode(errors="replace").strip().splitlines()[-1:] or [""]
        raise RuntimeError(f"rclone salió con {proc.returncode}: {last[0][:200]}")
    return sum(1 for p in Path(target).rglob("*") if p.is_file())


async def _mirror(ctx: AgentContext, today: str) -> bool:
    try:
        written = await mirror_once(ctx)
    except (ApiError, httpx.HTTPError, SchemaMismatch, RuntimeError, OSError, sqlite3.Error) as e:
        _failed(ctx, "mirror", e, mirror_tried_at=now_ms())
        return False
    ctx.store.put(MIRROR_DAY_KEY, today)
    _save(ctx, mirror_ok=True, mirror_error=None, mirror_at=now_ms(), mirror_rows=written)
    logger.info("mirror_done", rows=written)
    return True


async def _dump(ctx: AgentContext, today: str) -> None:
    settings = ctx.settings
    folder = settings.data_dir / "backups" / "weekly"
    target = folder / f"maunedas-{today}.sql.gz"
    try:
        size = await asyncio.to_thread(dump, settings.data_dir / "backups" / "mirror.sqlite", target)
        removed = rotate(folder, settings.backup_keep_weekly)
    except (OSError, sqlite3.Error) as e:
        _failed(ctx, "dump", e)
        return
    ctx.store.put(DUMP_DAY_KEY, today)
    _save(ctx, dump_ok=True, dump_error=None, dump_at=now_ms(), dump_file=target.name, dump_bytes=size)
    logger.info("dump_done", file=target.name, bytes=size, removed=removed)


async def _photos(ctx: AgentContext, today: str) -> bool:
    """False while a failed copy waits for its retry."""
    s = ctx.settings
    if not (s.r2_endpoint and s.r2_access_key_id and s.r2_secret_access_key.get_secret_value()):
        ctx.store.put(PHOTOS_DAY_KEY, today)
        _save(ctx, photos_ok=None, photos_error=NO_CREDENTIALS)
        return True
    tried = ctx.store.get(PHOTOS_TRIED_KEY)
    if tried and now_ms() - int(tried) < PHOTOS_RETRY_MS:
        return False
    ctx.store.put(PHOTOS_TRIED_KEY, str(now_ms()))
    try:
        files = await photos_once(ctx)
    except (OSError, RuntimeError, TimeoutError) as e:
        _failed(ctx, "photos", e)
        return True
    ctx.store.put(PHOTOS_DAY_KEY, today)
    _save(ctx, photos_ok=True, photos_error=None, photos_at=now_ms(), photos_files=files)
    logger.info("photos_done", files=files)
    return True


async def backup_once(ctx: AgentContext, at: datetime | None = None) -> bool:
    """Runs the jobs due today; True if one ran. The dump and the photos wait for today's mirror."""
    settings = ctx.settings
    if not settings.backup_enabled:
        return False
    local = (at or datetime.now(ZoneInfo(settings.tz))).astimezone(ZoneInfo(settings.tz))
    today = local.date().isoformat()
    if local.hour < settings.backup_hour:
        return False
    ran = False
    if ctx.store.get(MIRROR_DAY_KEY) != today:
        ran = True
        if not await _mirror(ctx, today):
            return True
    if local.weekday() == settings.backup_weekday and ctx.store.get(DUMP_DAY_KEY) != today:
        ran = True
        await _dump(ctx, today)
    if ctx.store.get(PHOTOS_DAY_KEY) != today:
        ran = await _photos(ctx, today) or ran
    return ran
