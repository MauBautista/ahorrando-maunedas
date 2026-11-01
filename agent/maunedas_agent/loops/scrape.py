"""Checks of due listings (07 §7): domain gate, concurrency, jitter and backoff (rule 10)."""

import asyncio
import random
import time
from collections.abc import Callable, Mapping
from typing import Any

from maunedas_agent import log
from maunedas_agent.adapters.base import Adapter, ScrapeResult
from maunedas_agent.adapters.registry import ADAPTERS
from maunedas_agent.context import AgentContext
from maunedas_agent.fetch.gate import spacing_for
from maunedas_agent.store import DueListing, now_ms

Jitter = Callable[[float, float], float]

DUE_PER_TICK = 10
MAX_LEVEL = 6
BACKOFF_BASE_MS = 15 * 60_000
BACKOFF_CAP_MS = 24 * 3_600_000
# Blocked this many times in a row: straight to the cap, no aggressive retries.
BLOCKS_TO_CAP = 3
PROMO_MAX = 300
ERROR_MAX = 500

logger = log.get("scrape")


def next_check(
    status: str, backoff_level: int, interval_min: int, now: int, jitter: Jitter = random.uniform
) -> tuple[int, int]:
    """(next_check_at, new backoff_level).

    After a good check, the interval ±10 %; otherwise 15 min, 30, 60… up to 24 h, also ±10 %.
    """
    if status in ("ok", "not_found"):
        return now + int(interval_min * 60_000 * jitter(0.9, 1.1)), 0
    level = min(backoff_level + 1, MAX_LEVEL)
    delay = min(BACKOFF_BASE_MS * 2 ** (level - 1), BACKOFF_CAP_MS)
    return now + int(delay * jitter(0.9, 1.1)), level


def plan(item: DueListing, status: str, now: int, jitter: Jitter = random.uniform) -> tuple[int, int, int]:
    """(next_check_at, backoff_level, block_streak) after a check."""
    streak = item.block_streak + 1 if status == "blocked" else 0
    if streak >= BLOCKS_TO_CAP:
        return now + int(BACKOFF_CAP_MS * jitter(0.9, 1.1)), MAX_LEVEL, streak
    at, level = next_check(status, item.backoff_level, item.interval_min, now, jitter)
    return at, level, streak


def payload(listing_id: str, checked_at: int, r: ScrapeResult) -> dict[str, Any]:
    """An AgentResult (07 §5.2)."""
    return {
        "listing_id": listing_id,
        "checked_at": checked_at,
        "status": r.status,
        "price_cents": r.price_cents,
        "list_price_cents": r.list_price_cents,
        "in_stock": r.in_stock,
        "promo_text": r.promo_text[:PROMO_MAX] if r.promo_text else None,
        "extra": r.extra or None,
        "error": r.error[:ERROR_MAX] if r.error else None,
    }


async def check(
    ctx: AgentContext, item: DueListing, adapter: Adapter, spacing: int, jitter: Jitter = random.uniform
) -> bool:
    """One listing; False if its domain cannot take a request yet (it stays due)."""
    async with ctx.browser_sem if adapter.needs_browser else ctx.http_sem:
        # The gate is taken right before the request, so waiting for a slot never shortens the spacing.
        if not ctx.gate.try_acquire(adapter.gate_key, spacing, now_ms()):
            return False
        started = time.monotonic()
        try:
            result = await adapter.fetch(item.url, ctx.fetch)
        except Exception as e:  # noqa: BLE001 - any adapter failure is a result, not a crash
            result = ScrapeResult(status="error", error=f"{type(e).__name__}: {e}")
    checked_at = now_ms()
    next_at, level, streak = plan(item, result.status, checked_at, jitter)
    with ctx.store.tx():
        ctx.store.outbox_add(item.id, payload(item.id, checked_at, result), checked_at)
        ctx.store.reschedule(item.id, result.status, checked_at, next_at, level, streak)
    logger.info(
        "scrape",
        listing_id=item.id,
        adapter=adapter.name,
        status=result.status,
        method=result.extra.get("method"),
        ms=round((time.monotonic() - started) * 1000),
        error=result.error,
    )
    if streak == BLOCKS_TO_CAP:
        logger.warning("listing_blocked", listing_id=item.id, adapter=adapter.name, streak=streak)
    return True


async def scrape_once(
    ctx: AgentContext, adapters: Mapping[str, Adapter] = ADAPTERS, jitter: Jitter = random.uniform
) -> int:
    """Checks the due listings whose domain is free; returns how many were checked."""
    now = now_ms()
    ctx.store.ensure_scheduled(now)
    config = ctx.store.min_spacing()
    jobs = []
    for item in ctx.store.due_listings(now, DUE_PER_TICK):
        adapter = adapters.get(item.adapter)
        if adapter is None:
            continue
        jobs.append(check(ctx, item, adapter, spacing_for(adapter, config), jitter))
    done = await asyncio.gather(*jobs)
    return sum(done)
