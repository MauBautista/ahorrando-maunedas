"""/work every POLL_INTERVAL_S (07 §5.1): heartbeat, listings to check, store defaults and "Revisar ahora"."""

import os
from typing import Any

import httpx

from maunedas_agent import __version__, log
from maunedas_agent.api import ApiError
from maunedas_agent.context import AgentContext
from maunedas_agent.loops.backup import status as backup_status
from maunedas_agent.store import POLL_TICK_KEY, WORK_OK_KEY, now_ms

# Pages of listings in one tick at most (200 each); the rest come in the next one.
MAX_PAGES = 25
LAST_ERROR_MAX = 500

logger = log.get("poll")


def mem_mb() -> float:
    """Resident memory of this process, from /proc (0 where it does not exist)."""
    try:
        with open("/proc/self/status", encoding="ascii") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        pass
    return 0.0


def work_request(ctx: AgentContext, at: int) -> dict[str, Any]:
    store = ctx.store
    return {
        "agent_id": ctx.settings.agent_id,
        "agent_version": __version__,
        "cursor": store.cursor(),
        "info": {
            "outbox": store.outbox_size(),
            "due": store.due_count(at),
            "mem_mb": mem_mb(),
            "load1": round(os.getloadavg()[0], 2),
            "blocked": store.blocked_adapters(),
            "last_error": ctx.last_error[:LAST_ERROR_MAX] if ctx.last_error else None,
            # Outcome of the last backups (07 §10), for the admin's agent screen.
            "backup": backup_status(ctx),
        },
    }


async def poll_once(ctx: AgentContext) -> bool:
    """One tick; True if the Worker answered. Failures are logged and reported in the next /work."""
    at = now_ms()
    ctx.store.put(POLL_TICK_KEY, str(at))
    try:
        for _ in range(MAX_PAGES):
            work = await ctx.api.work(work_request(ctx, at))
            ctx.store.apply_work(work)
            if not work["listings"]["has_more"]:
                break
    except (ApiError, httpx.HTTPError) as e:
        ctx.last_error = f"work: {e}"
        logger.warning("work_failed", error=str(e), status=getattr(e, "status", None))
        return False
    scheduled = ctx.store.request_checks(work["check_now"], at)
    if scheduled:
        logger.info("check_now", listing_ids=scheduled)
    ctx.store.put(WORK_OK_KEY, str(at))
    ctx.last_error = None
    return True
