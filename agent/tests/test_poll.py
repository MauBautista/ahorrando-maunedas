import json

import httpx
import pytest
import respx

from maunedas_agent import __version__
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.context import AgentContext
from maunedas_agent.loops.poll import poll_once
from maunedas_agent.store import POLL_TICK_KEY, WORK_OK_KEY, Store
from tests.conftest import API
from tests.support import L1, L2, listing, work


@pytest.fixture
async def ctx(settings: Settings, store: Store):
    async def sleep(_: float) -> None:
        pass

    api = AgentApi(settings, sleep=sleep)
    yield AgentContext(settings=settings, store=store, api=api)
    await api.aclose()


def sent(route: respx.Route) -> list[dict]:
    return [json.loads(c.request.content) for c in route.calls]


@respx.mock
async def test_one_tick_reports_and_takes_every_page(ctx: AgentContext) -> None:
    route = respx.post(f"{API}/agent/v1/work").mock(
        side_effect=[
            httpx.Response(200, json=work([listing(L1, 5)], has_more=True)),
            httpx.Response(200, json=work([listing(L2, 6)], check_now=[L2])),
        ]
    )
    assert await poll_once(ctx) is True
    first, second = sent(route)
    assert first["agent_id"] == "home"
    assert first["agent_version"] == __version__
    assert first["cursor"] == [0, ""]
    assert second["cursor"] == [5, L1]
    info = first["info"]
    assert {k: info[k] for k in ("outbox", "due", "blocked", "last_error")} == {
        "outbox": 0,
        "due": 0,
        "blocked": [],
        "last_error": None,
    }
    assert info["mem_mb"] > 0 and info["load1"] >= 0
    assert ctx.store.cursor() == [6, L2]
    assert [r[0] for r in ctx.store.db.execute("SELECT listing_id FROM schedule")] == [L2]
    assert ctx.store.get(WORK_OK_KEY) == ctx.store.get(POLL_TICK_KEY)


@respx.mock
async def test_a_failure_is_reported_in_the_next_tick(ctx: AgentContext) -> None:
    route = respx.post(f"{API}/agent/v1/work").mock(
        side_effect=[
            httpx.Response(401, json={"error": {"code": "UNAUTHENTICATED"}}),
            httpx.Response(200, json=work()),
        ]
    )
    assert await poll_once(ctx) is False
    # The tick counts for the healthcheck; the Worker was not reached.
    assert ctx.store.get(POLL_TICK_KEY) is not None
    assert ctx.store.get(WORK_OK_KEY) is None
    assert ctx.last_error == "work: HTTP 401 UNAUTHENTICATED"
    assert await poll_once(ctx) is True
    assert sent(route)[1]["info"]["last_error"] == "work: HTTP 401 UNAUTHENTICATED"
    assert ctx.last_error is None


@respx.mock
async def test_pages_in_one_tick_are_bounded(ctx: AgentContext) -> None:
    route = respx.post(f"{API}/agent/v1/work").respond(200, json=work([listing(L1, 5)], has_more=True))
    assert await poll_once(ctx) is True
    assert route.call_count == 25


@respx.mock
async def test_a_long_error_is_cut(ctx: AgentContext) -> None:
    route = respx.post(f"{API}/agent/v1/work").respond(200, json=work())
    ctx.last_error = "x" * 900
    await poll_once(ctx)
    assert len(sent(route)[0]["info"]["last_error"]) == 500
