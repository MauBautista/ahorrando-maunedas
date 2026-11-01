import gzip
import json
import os
import shutil
import sqlite3
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx
from pydantic import SecretStr

from maunedas_agent.api import AgentApi
from maunedas_agent.backup import OWN_PREFIX, Mirror, SchemaMismatch, dump, rotate
from maunedas_agent.config import Settings
from maunedas_agent.context import AgentContext
from maunedas_agent.loops import backup as backup_loop
from maunedas_agent.loops.backup import (
    DUMP_DAY_KEY,
    MIRROR_DAY_KEY,
    NO_CREDENTIALS,
    PHOTOS_RETRY_MS,
    backup_once,
    status,
)
from maunedas_agent.loops.poll import work_request
from maunedas_agent.store import Store, now_ms
from tests.conftest import API, TOKEN

MIGRATIONS = Path(__file__).parents[2] / "apps" / "api" / "migrations"
URL = f"{API}/agent/v1/backup/pull"
MX = ZoneInfo("America/Mexico_City")
ADMIN = "0192a5e9-0000-7000-8000-00000000a0a0"
MEMBER = "0192a5e9-0000-7000-8000-00000000b0b0"
STORE = "0192a5e9-0000-7000-8000-0000000000aa"


def user(id: str, username: str, version: int, **over: object) -> dict:
    return {
        "id": id,
        "username": username,
        "display_name": username.title(),
        "google_email": None,
        "role": "member",
        "active": 1,
        "created_at": 1,
        "updated_at": version,
        "version": version,
        **over,
    }


def identity(uid: str, user_id: str) -> dict:
    return {"firebase_uid": uid, "user_id": user_id, "provider": "password", "created_at": 1}


def page(changes: dict, cursors: dict, has_more: bool = False, replace: tuple = ("user_identities",)) -> dict:
    return {
        "changes": changes,
        "cursors": cursors,
        "replace": [t for t in replace if t in changes],
        "has_more": has_more,
        "server_time": 1,
        "schema_version": 1,
    }


PAGE_1 = page(
    {
        "users": [user(ADMIN, "mau", 3, role="admin", google_email="mau@example.com")],
        "user_identities": [identity("uid-admin", ADMIN), identity("uid-member", MEMBER)],
    },
    {"users": [3, ADMIN], "stores": [0, ""]},
    has_more=True,
)
PAGE_2 = page(
    {
        "users": [user(MEMBER, "pepe", 4)],
        "stores": [
            {
                "id": STORE,
                "name": "Costco",
                "chain": None,
                "kind": "both",
                "website": None,
                "adapter": "costco_mx",
                "default_check_interval_min": 480,
                "created_at": 1,
                "updated_at": 5,
                "deleted_at": None,
                "updated_by": ADMIN,
                "version": 5,
            }
        ],
        "user_identities": [identity("uid-admin", ADMIN), identity("uid-member", MEMBER)],
    },
    {"users": [4, MEMBER], "stores": [5, STORE]},
)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(  # type: ignore[call-arg]
        _env_file=None, api_base=API, agent_token=TOKEN, data_dir=tmp_path, migrations_dir=MIGRATIONS
    )


@pytest.fixture
async def ctx(settings: Settings, store: Store) -> AsyncIterator[AgentContext]:
    async def no_sleep(_: float) -> None:
        pass

    api = AgentApi(settings, sleep=no_sleep)
    c = AgentContext(settings=settings, store=store, api=api)
    yield c
    await api.aclose()


def mirror_path(settings: Settings) -> Path:
    return settings.data_dir / "backups" / "mirror.sqlite"


def test_the_mirror_is_built_from_d1_migrations_once(tmp_path: Path) -> None:
    folder = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, folder)
    m = Mirror(tmp_path / "m.sqlite", folder)
    assert {"users", "stores", "price_observations", "user_identities", "ai_usage"} <= set(m.counts())
    assert not any(t.startswith(OWN_PREFIX) for t in m.counts())
    assert m.migrate(folder) == []
    m.close()
    # A later migration is applied on the next run, once.
    (folder / "9999_extra.sql").write_text("CREATE TABLE extra_test (id TEXT PRIMARY KEY);")
    again = Mirror(tmp_path / "m.sqlite", folder)
    assert "extra_test" in again.counts()
    again.close()
    # A broken migration leaves nothing half applied.
    (folder / "9999_zbroken.sql").write_text("CREATE TABLE half (id TEXT); CREATE TABLE nope (;")
    with pytest.raises(sqlite3.Error):
        Mirror(tmp_path / "m.sqlite", folder)
    check = sqlite3.connect(tmp_path / "m.sqlite")
    assert check.execute("SELECT count(*) FROM sqlite_master WHERE name = 'half'").fetchone()[0] == 0
    check.close()


def test_a_failed_migration_leaves_the_mirror_usable(tmp_path: Path) -> None:
    folder = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, folder)
    m = Mirror(tmp_path / "m.sqlite", folder)
    (folder / "9999_broken.sql").write_text("CREATE TABLE half (id TEXT); CREATE TABLE nope (;")
    with pytest.raises(sqlite3.Error):
        m.migrate(folder)
    assert not m.db.in_transaction
    assert m.apply(PAGE_1) == 3
    assert "half" not in m.counts()
    m.close()


def test_pages_upsert_rows_replace_whole_tables_and_keep_cursors(tmp_path: Path) -> None:
    m = Mirror(tmp_path / "m.sqlite", MIGRATIONS)
    assert m.apply(PAGE_1) == 3
    assert m.apply(PAGE_2) == 4
    # An edited row comes again with its new version.
    assert (
        m.apply(page({"users": [user(MEMBER, "pepe", 9, display_name="Pepe G.")]}, {"users": [9, MEMBER]}))
        == 1
    )
    assert m.db.execute("SELECT display_name, version FROM users WHERE id = ?", (MEMBER,)).fetchone() == (
        "Pepe G.",
        9,
    )
    assert m.db.execute("SELECT google_email FROM users WHERE id = ?", (ADMIN,)).fetchone() == (
        "mau@example.com",
    )
    assert m.cursors() == {"users": [9, MEMBER], "stores": [5, STORE]}
    # A removed login leaves the mirror; an empty whole table empties it.
    m.apply(page({"user_identities": [identity("uid-admin", ADMIN)]}, {}))
    assert [r[0] for r in m.db.execute("SELECT firebase_uid FROM user_identities")] == ["uid-admin"]
    m.apply(page({"user_identities": []}, {}))
    assert m.counts()["user_identities"] == 0
    assert m.counts()["users"] == 2
    m.close()


def test_rows_the_mirror_cannot_hold_change_nothing(tmp_path: Path) -> None:
    m = Mirror(tmp_path / "m.sqlite", MIGRATIONS)
    m.apply(PAGE_1)
    bad_column = page({"users": [user(MEMBER, "pepe", 4, nickname="P")]}, {"users": [4, MEMBER]})
    with pytest.raises(SchemaMismatch, match="nickname"):
        m.apply(bad_column)
    with pytest.raises(SchemaMismatch, match="new_table"):
        m.apply(page({"new_table": [{"id": "x"}]}, {"new_table": [1, "x"]}))
    assert m.cursors() == {"users": [3, ADMIN], "stores": [0, ""]}
    assert m.counts()["users"] == 1
    m.close()


def test_the_dump_restores_the_same_rows_without_bookkeeping(tmp_path: Path) -> None:
    m = Mirror(tmp_path / "m.sqlite", MIGRATIONS)
    m.apply(PAGE_1)
    m.apply(PAGE_2)
    expected = m.counts()
    m.close()
    target = tmp_path / "weekly" / "maunedas-2026-11-01.sql.gz"
    assert dump(tmp_path / "m.sqlite", target) == target.stat().st_size > 0
    assert not list(target.parent.glob("*.partial"))
    sql = gzip.decompress(target.read_bytes()).decode()
    assert OWN_PREFIX not in sql
    assert "mau@example.com" in sql
    restored = sqlite3.connect(":memory:")
    restored.executescript(sql)
    for table, count in expected.items():
        assert restored.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0] == count, table


def test_a_failed_dump_leaves_no_file(tmp_path: Path) -> None:
    (tmp_path / "m.sqlite").write_bytes(b"not a database" * 100)
    target = tmp_path / "weekly" / "maunedas-2026-11-01.sql.gz"
    with pytest.raises(sqlite3.DatabaseError):
        dump(tmp_path / "m.sqlite", target)
    assert list(target.parent.iterdir()) == []


def test_rotation_keeps_the_newest_dumps(tmp_path: Path) -> None:
    for day in range(1, 11):
        (tmp_path / f"maunedas-2026-10-{day:02d}.sql.gz").write_bytes(b"x")
    (tmp_path / "otra-cosa.txt").write_text("x")
    assert rotate(tmp_path, 8) == ["maunedas-2026-10-01.sql.gz", "maunedas-2026-10-02.sql.gz"]
    assert sorted(p.name for p in tmp_path.glob("maunedas-*"))[0] == "maunedas-2026-10-03.sql.gz"
    assert (tmp_path / "otra-cosa.txt").exists()


def at(day: int, hour: int) -> datetime:
    # 2026-11-01 is a Sunday (BACKUP_WEEKDAY 6).
    return datetime(2026, 11, day, hour, 5, tzinfo=MX)


@respx.mock
async def test_the_mirror_runs_once_a_day_after_its_hour(ctx: AgentContext, settings: Settings) -> None:
    route = respx.post(URL).mock(
        side_effect=[
            httpx.Response(200, json=PAGE_1),
            httpx.Response(200, json=PAGE_2),
            httpx.Response(200, json=page({}, PAGE_2["cursors"])),
        ]
    )
    assert await backup_once(ctx, at(2, 2)) is False
    assert await backup_once(ctx, at(2, 3)) is True
    sent = [json.loads(c.request.content) for c in route.calls]
    assert sent[0] == {"cursors": {}, "limit": 200}
    assert sent[1]["cursors"] == {"users": [3, ADMIN], "stores": [0, ""]}
    assert ctx.store.get(MIRROR_DAY_KEY) == "2026-11-02"
    assert {k: status(ctx)[k] for k in ("mirror_ok", "mirror_error", "mirror_rows")} == {
        "mirror_ok": True,
        "mirror_error": None,
        "mirror_rows": 7,
    }
    # Without R2 credentials the photos are skipped, and said so.
    assert (status(ctx)["photos_ok"], status(ctx)["photos_error"]) == (None, NO_CREDENTIALS)
    assert await backup_once(ctx, at(2, 23)) is False
    # Monday: no weekly dump.
    assert not (settings.data_dir / "backups" / "weekly").exists()
    # The next day it runs again from where it stopped.
    assert await backup_once(ctx, at(3, 4)) is True
    assert json.loads(route.calls[-1].request.content)["cursors"] == PAGE_2["cursors"]
    # Reported in /work.
    assert work_request(ctx, 0)["info"]["backup"]["mirror_ok"] is True


@respx.mock
async def test_a_failed_mirror_is_reported_and_retried(ctx: AgentContext) -> None:
    respx.post(URL).mock(
        side_effect=[
            httpx.Response(503),
            httpx.Response(503),
            httpx.Response(503),
            httpx.Response(200, json=PAGE_2),
        ]
    )
    assert await backup_once(ctx, at(2, 3)) is True
    assert ctx.store.get(MIRROR_DAY_KEY) is None
    assert status(ctx)["mirror_ok"] is False and status(ctx)["mirror_error"] == "HTTP 503"
    assert ctx.last_error == "backup: HTTP 503"
    # Nothing else runs on a failed mirror: the dump and the photos wait for a good one.
    assert "photos_ok" not in status(ctx) and "dump_ok" not in status(ctx)
    assert await backup_once(ctx, at(2, 3)) is True
    assert status(ctx)["mirror_ok"] is True and status(ctx)["mirror_error"] is None


@respx.mock
async def test_sunday_also_dumps_and_rotates(ctx: AgentContext, settings: Settings) -> None:
    respx.post(URL).mock(return_value=httpx.Response(200, json=PAGE_2))
    weekly = settings.data_dir / "backups" / "weekly"
    weekly.mkdir(parents=True)
    for day in range(1, 10):
        (weekly / f"maunedas-2026-09-{day:02d}.sql.gz").write_bytes(b"x")
    assert await backup_once(ctx, at(1, 3)) is True
    files = sorted(p.name for p in weekly.glob("*.sql.gz"))
    assert len(files) == 8 and files[-1] == "maunedas-2026-11-01.sql.gz"
    s = status(ctx)
    assert (s["dump_ok"], s["dump_file"], s["dump_bytes"] > 0) == (True, "maunedas-2026-11-01.sql.gz", True)
    assert ctx.store.get(DUMP_DAY_KEY) == "2026-11-01"
    # Not twice the same Sunday even if the mirror runs again.
    ctx.store.put(MIRROR_DAY_KEY, "")
    (weekly / "maunedas-2026-11-01.sql.gz").unlink()
    await backup_once(ctx, at(1, 5))
    assert not (weekly / "maunedas-2026-11-01.sql.gz").exists()


@respx.mock
async def test_a_failed_dump_is_retried_without_a_new_mirror(
    ctx: AgentContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    route = respx.post(URL).mock(return_value=httpx.Response(200, json=PAGE_2))

    def full_disk(*_: object) -> int:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(backup_loop, "dump", full_disk)
    assert await backup_once(ctx, at(1, 3)) is True
    assert (status(ctx)["mirror_ok"], status(ctx)["dump_ok"]) == (True, False)
    assert "No space left" in status(ctx)["dump_error"]
    monkeypatch.undo()
    assert await backup_once(ctx, at(1, 4)) is True
    assert status(ctx)["dump_ok"] is True
    assert route.call_count == 1


FAKE_RCLONE = """#!/bin/sh
# Records how it was called (never the secret itself) and copies two "photos".
echo "$@" > "$CALLS"
echo "type=$RCLONE_CONFIG_R2_TYPE provider=$RCLONE_CONFIG_R2_PROVIDER key=$RCLONE_CONFIG_R2_ACCESS_KEY_ID \
endpoint=$RCLONE_CONFIG_R2_ENDPOINT secret_len=${#RCLONE_CONFIG_R2_SECRET_ACCESS_KEY} \
nocheck=$RCLONE_CONFIG_R2_NO_CHECK_BUCKET" >> "$CALLS"
if [ -n "$FAIL" ]; then echo "noise" >&2; echo "Failed to sync: 403 Forbidden" >&2; exit 3; fi
mkdir -p "$3/images/a" && echo x > "$3/images/a/1.webp" && echo y > "$3/images/a/2.webp"
"""


@respx.mock
async def test_photos_are_copied_with_rclone_once_there_are_credentials(
    ctx: AgentContext,
    settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    respx.post(URL).mock(return_value=httpx.Response(200, json=PAGE_2))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "rclone").write_text(FAKE_RCLONE)
    (bin_dir / "rclone").chmod(0o755)
    calls = tmp_path / "calls.txt"
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    monkeypatch.setenv("CALLS", str(calls))
    monkeypatch.setenv("FAIL", "1")
    ctx.settings = settings.model_copy(
        update={
            "r2_endpoint": "https://acct.r2.cloudflarestorage.com",
            "r2_access_key_id": "read-only-key",
            "r2_secret_access_key": SecretStr("s3cr3t-value"),
        }
    )
    assert await backup_once(ctx, at(2, 3)) is True
    assert (status(ctx)["photos_ok"], status(ctx)["photos_error"]) == (
        False,
        "rclone salió con 3: Failed to sync: 403 Forbidden",
    )
    # Not retried before an hour.
    calls.unlink()
    assert await backup_once(ctx, at(2, 4)) is False
    assert not calls.exists()
    monkeypatch.delenv("FAIL")
    ctx.store.put("backup_photos_tried_at", str(now_ms() - PHOTOS_RETRY_MS))
    assert await backup_once(ctx, at(2, 5)) is True
    s = status(ctx)
    assert (s["photos_ok"], s["photos_error"], s["photos_files"]) == (True, None, 2)
    args, env = calls.read_text().splitlines()
    assert args == f"sync r2:maunedas-images {settings.data_dir / 'backups' / 'r2'} --fast-list --transfers 4"
    assert env == (
        "type=s3 provider=Cloudflare key=read-only-key endpoint=https://acct.r2.cloudflarestorage.com "
        "secret_len=12 nocheck=true"
    )
    assert "s3cr3t-value" not in capsys.readouterr().out
    assert await backup_once(ctx, at(2, 6)) is False


async def test_backups_can_be_turned_off(settings: Settings, store: Store) -> None:
    off = settings.model_copy(update={"backup_enabled": False})
    c = AgentContext(settings=off, store=store, api=AgentApi(off))
    assert await backup_once(c, at(2, 3)) is False
    await c.aclose()
