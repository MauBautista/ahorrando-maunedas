import asyncio
import json
import random
from collections.abc import AsyncIterator

import pytest

from maunedas_agent.adapters.base import ScrapeResult
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.context import AgentContext
from maunedas_agent.loops.scrape import next_check, plan, scrape_once
from maunedas_agent.store import DueListing, Store, now_ms
from tests.fakes import FakeAdapter
from tests.support import L1, L2, L3, STORE, listing, work

MIN = 60_000
HOUR = 60 * MIN
FIXED = lambda a, b: 1.0  # noqa: E731 - no jitter


def test_next_check_after_a_good_check_is_the_interval_with_jitter() -> None:
    seen = set()
    for _ in range(500):
        at, level = next_check("ok", 3, 480, 0)
        assert 0.9 * 480 * MIN <= at <= 1.1 * 480 * MIN
        assert level == 0
        seen.add(at)
    assert len(seen) > 100
    assert next_check("not_found", 2, 60, 1000, FIXED) == (1000 + 60 * MIN, 0)


def test_next_check_backs_off_after_failures_up_to_its_top_level() -> None:
    delays = []
    level = 0
    for _ in range(8):
        at, level = next_check("error", level, 480, 0, FIXED)
        delays.append((at // MIN, level))
    assert delays == [(15, 1), (30, 2), (60, 3), (120, 4), (240, 5), (480, 6), (480, 6), (480, 6)]
    at, _ = next_check("blocked", 0, 480, 0, lambda a, b: b)
    assert at == int(15 * MIN * 1.1)


def test_three_blocks_in_a_row_go_to_the_cap() -> None:
    item = DueListing(L1, "amazon_mx", "u", 480, 0, 0)
    first = plan(item, "blocked", 0, FIXED)
    assert first == (15 * MIN, 1, 1)
    second = plan(DueListing(L1, "amazon_mx", "u", 480, 1, 1), "blocked", 0, FIXED)
    assert second == (30 * MIN, 2, 2)
    third = plan(DueListing(L1, "amazon_mx", "u", 480, 2, 2), "blocked", 0, FIXED)
    assert third == (24 * HOUR, 6, 3)
    assert plan(DueListing(L1, "amazon_mx", "u", 480, 6, 3), "blocked", 0, FIXED) == (24 * HOUR, 6, 4)
    # An error breaks the streak; a good check clears everything.
    assert plan(DueListing(L1, "amazon_mx", "u", 480, 6, 4), "error", 0, FIXED) == (480 * MIN, 6, 0)
    assert plan(DueListing(L1, "amazon_mx", "u", 480, 6, 0), "ok", 0, FIXED) == (480 * MIN, 0, 0)


def test_only_active_listings_are_scheduled_and_due(store: Store) -> None:
    store.apply_work(work([listing(L1, 5), listing(L2, 6, active=0), listing(L3, 7, interval_min=60)]))
    assert store.ensure_scheduled(1000) == 2
    assert store.ensure_scheduled(2000) == 0
    store.db.execute("INSERT INTO schedule (listing_id, next_check_at) VALUES (?, 0)", (L2,))
    due = store.due_listings(1000, 10)
    assert [(d.id, d.interval_min) for d in due] == [(L1, 480), (L3, 60)]
    assert due[0].url == listing(L1, 5)["canonical_url"]
    assert store.due_listings(999, 10) == []
    assert len(store.due_listings(1000, 1)) == 1
    # A listing's store default applies when it has no interval of its own.
    store.db.execute("UPDATE store_defaults SET interval_min = 120 WHERE store_id = ?", (STORE,))
    assert [d.interval_min for d in store.due_listings(1000, 10)] == [120, 60]
    store.db.execute("DELETE FROM store_defaults")
    assert [d.interval_min for d in store.due_listings(1000, 10)] == [480, 60]


def test_check_now_makes_a_listing_due(store: Store) -> None:
    store.apply_work(work([listing(L1, 5)]))
    store.ensure_scheduled(0)
    store.reschedule(L1, "ok", 0, 10 * HOUR, 0, 0)
    assert store.due_listings(HOUR, 10) == []
    store.request_checks([L1], HOUR)
    assert [d.id for d in store.due_listings(HOUR, 10)] == [L1]


@pytest.fixture
async def ctx(settings: Settings, store: Store) -> AsyncIterator[AgentContext]:
    api = AgentApi(settings)
    c = AgentContext(settings=settings, store=store, api=api)
    yield c
    await api.aclose()


def outbox(store: Store) -> list[dict]:
    return [json.loads(r[0]) for r in store.db.execute("SELECT payload FROM outbox ORDER BY seq")]


def schedule(store: Store, listing_id: str) -> dict:
    return dict(store.db.execute("SELECT * FROM schedule WHERE listing_id = ?", (listing_id,)).fetchone())


async def test_due_listings_are_checked_and_their_results_queued(ctx: AgentContext) -> None:
    amazon = FakeAdapter("amazon_mx")
    sams = FakeAdapter(
        "sams_mx", results=[ScrapeResult("ok", 2899, 3299, True, "2x1", {"method": "http_jsonld"})]
    )
    ctx.store.apply_work(work([listing(L1, 5), listing(L2, 6, adapter="sams_mx")]))
    before = now_ms()
    assert await scrape_once(ctx, {"amazon_mx": amazon, "sams_mx": sams}, FIXED) == 2
    assert amazon.calls == [listing(L1, 5)["canonical_url"]]
    queued = {p["listing_id"]: p for p in outbox(ctx.store)}
    assert queued[L2] == {
        "listing_id": L2,
        "checked_at": queued[L2]["checked_at"],
        "status": "ok",
        "price_cents": 2899,
        "list_price_cents": 3299,
        "in_stock": True,
        "promo_text": "2x1",
        "extra": {"method": "http_jsonld"},
        "error": None,
    }
    assert queued[L2]["checked_at"] >= before
    row = schedule(ctx.store, L2)
    assert row["last_status"] == "ok"
    assert row["last_checked_at"] == queued[L2]["checked_at"]
    assert row["next_check_at"] == row["last_checked_at"] + 480 * MIN
    # Nothing is due any more.
    assert await scrape_once(ctx, {"amazon_mx": amazon, "sams_mx": sams}, FIXED) == 0


async def test_one_request_per_domain_spacing(ctx: AgentContext) -> None:
    amazon = FakeAdapter("amazon_mx", min_spacing_s=1)
    ctx.store.apply_work(work([listing(L1, 5), listing(L2, 6), listing(L3, 7, adapter="walmart_mx")]))
    # Walmart has no adapter (T34): never fetched, it just stays due.
    assert await scrape_once(ctx, {"amazon_mx": amazon}, FIXED) == 1
    assert len(amazon.calls) == 1
    assert {d.id for d in ctx.store.due_listings(now_ms(), 10)} == {L2, L3}
    # The Worker's spacing wins when it is stricter than the adapter's.
    await asyncio.sleep(1.05)
    ctx.store.put("min_spacing_s", json.dumps({"amazon_mx": 60, "default": 20}))
    assert await scrape_once(ctx, {"amazon_mx": amazon}, FIXED) == 0
    ctx.store.put("min_spacing_s", json.dumps({"default": 0}))
    assert await scrape_once(ctx, {"amazon_mx": amazon}, FIXED) == 1


async def test_a_failing_adapter_is_an_error_result_with_backoff(ctx: AgentContext) -> None:
    amazon = FakeAdapter("amazon_mx", results=[RuntimeError("x" * 900)])
    ctx.store.apply_work(work([listing(L1, 5)]))
    await scrape_once(ctx, {"amazon_mx": amazon}, FIXED)
    [p] = outbox(ctx.store)
    assert p["status"] == "error"
    assert p["price_cents"] is None and p["extra"] is None
    assert p["error"].startswith("RuntimeError: xxx") and len(p["error"]) == 500
    row = schedule(ctx.store, L1)
    assert (row["backoff_level"], row["next_check_at"] - row["last_checked_at"]) == (1, 15 * MIN)


async def test_long_promotions_are_cut(ctx: AgentContext) -> None:
    amazon = FakeAdapter("amazon_mx", results=[ScrapeResult("ok", 100, promo_text="p" * 400)])
    ctx.store.apply_work(work([listing(L1, 5)]))
    await scrape_once(ctx, {"amazon_mx": amazon}, FIXED)
    assert len(outbox(ctx.store)[0]["promo_text"]) == 300


async def test_a_listing_blocked_three_times_waits_a_day(ctx: AgentContext) -> None:
    amazon = FakeAdapter("amazon_mx", results=[ScrapeResult("blocked")] * 3)
    ctx.store.apply_work(work([listing(L1, 5)]))
    for _ in range(3):
        ctx.store.db.execute("UPDATE schedule SET next_check_at = 0")
        ctx.store.db.execute("DELETE FROM domain_gate")
        await scrape_once(ctx, {"amazon_mx": amazon}, FIXED)
    row = schedule(ctx.store, L1)
    assert (row["block_streak"], row["backoff_level"]) == (3, 6)
    assert row["next_check_at"] - row["last_checked_at"] == 24 * HOUR
    assert ctx.store.blocked_adapters() == ["amazon_mx"]
    assert [p["status"] for p in outbox(ctx.store)] == ["blocked"] * 3


async def test_concurrency_is_bounded_by_kind(ctx: AgentContext) -> None:
    hold = asyncio.Event()
    running = [0, 0]
    http = {n: FakeAdapter(n, hold=hold, running=running) for n in ("a_mx", "b_mx", "c_mx")}
    browser_running = [0, 0]
    browser = {
        n: FakeAdapter(n, needs_browser=True, hold=hold, running=browser_running) for n in ("d_mx", "e_mx")
    }
    ids = [f"0192a000-0000-7000-8000-00000000010{i}" for i in range(5)]
    names = [*http, *browser]
    ctx.store.apply_work(
        work([listing(i, 10 + n, adapter=a) for n, (i, a) in enumerate(zip(ids, names, strict=True))])
    )
    task = asyncio.create_task(scrape_once(ctx, {**http, **browser}, FIXED))
    await asyncio.sleep(0.05)
    assert (running[0], browser_running[0]) == (2, 1)
    hold.set()
    assert await task == 5
    assert (running[1], browser_running[1]) == (2, 1)


async def test_random_jitter_is_used_by_default(ctx: AgentContext) -> None:
    random.seed(7)
    amazon = FakeAdapter("amazon_mx")
    ctx.store.apply_work(work([listing(L1, 5)]))
    await scrape_once(ctx, {"amazon_mx": amazon})
    row = schedule(ctx.store, L1)
    delay = row["next_check_at"] - row["last_checked_at"]
    assert 0.9 * 480 * MIN <= delay <= 1.1 * 480 * MIN and delay != 480 * MIN
