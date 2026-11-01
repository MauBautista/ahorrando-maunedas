import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import respx

from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.context import AgentContext
from maunedas_agent.loops.flush import flush_once
from maunedas_agent.store import Store
from tests.conftest import API
from tests.support import L1

URL = f"{API}/agent/v1/observations"


async def no_sleep(_: float) -> None:
    pass


@pytest.fixture
async def ctx(settings: Settings, store: Store) -> AsyncIterator[AgentContext]:
    api = AgentApi(settings, sleep=no_sleep)
    c = AgentContext(settings=settings, store=store, api=api)
    yield c
    await api.aclose()


def queue(store: Store, n: int, start: int = 1) -> None:
    for i in range(start, start + n):
        store.outbox_add(L1, {"listing_id": L1, "checked_at": i, "status": "ok", "price_cents": i}, i)


def sent(route: respx.Route) -> list[list[int]]:
    return [[r["checked_at"] for r in json.loads(c.request.content)["results"]] for c in route.calls]


@respx.mock
async def test_sends_everything_in_order_in_requests_of_twenty(ctx: AgentContext) -> None:
    queue(ctx.store, 45)
    route = respx.post(URL).respond(200, json={"accepted": 1, "observations_created": 1})
    assert await flush_once(ctx) == 45
    batches = sent(route)
    assert [len(b) for b in batches] == [20, 20, 5]
    assert [x for b in batches for x in b] == list(range(1, 46))
    assert ctx.store.outbox_size() == 0
    assert await flush_once(ctx) == 0
    assert route.call_count == 3


@respx.mock
async def test_no_result_is_lost_when_the_network_fails(ctx: AgentContext, settings: Settings) -> None:
    queue(ctx.store, 25)
    route = respx.post(URL).mock(
        side_effect=[
            httpx.Response(200, json={}),
            httpx.ConnectError("down"),
            httpx.ConnectError("down"),
            httpx.ConnectError("down"),
        ]
    )
    assert await flush_once(ctx) == 20
    assert ctx.store.outbox_size() == 5
    assert ctx.last_error == "observations: down"
    # The queue is on disk: a restart keeps it.
    ctx.store.close()
    reopened = Store(settings.db_path)
    ctx.store = reopened
    assert reopened.outbox_size() == 5
    route.side_effect = None
    route.return_value = httpx.Response(200, json={})
    assert await flush_once(ctx) == 5
    assert sent(route)[-1] == [21, 22, 23, 24, 25]
    assert reopened.outbox_size() == 0


@respx.mock
@pytest.mark.parametrize("status", [401, 429, 503])
async def test_results_wait_while_the_worker_refuses_for_now(ctx: AgentContext, status: int) -> None:
    queue(ctx.store, 3)
    respx.post(URL).respond(status)
    assert await flush_once(ctx) == 0
    assert ctx.store.outbox_size() == 3
    assert ctx.last_error == f"observations: HTTP {status}"


@respx.mock
async def test_a_result_the_worker_rejects_is_dropped_alone(ctx: AgentContext) -> None:
    queue(ctx.store, 4)

    def answer(request: httpx.Request) -> httpx.Response:
        results = json.loads(request.content)["results"]
        if any(r["checked_at"] == 2 for r in results):
            return httpx.Response(400, json={"error": {"code": "VALIDATION"}})
        return httpx.Response(200, json={})

    route = respx.post(URL).mock(side_effect=answer)
    assert await flush_once(ctx) == 3
    assert sent(route) == [[1, 2, 3, 4], [1], [2], [3], [4]]
    assert ctx.store.outbox_size() == 0
    assert ctx.last_error == "observations: result rejected (HTTP 400 VALIDATION)"


def test_the_outbox_keeps_payloads_as_json(tmp_path: Path) -> None:
    s = Store(tmp_path / "a.sqlite")
    s.outbox_add(L1, {"listing_id": L1, "extra": {"seller": "Amazon México"}}, 5)
    [p] = s.outbox_batch(20)
    assert (p.listing_id, p.payload) == (L1, {"listing_id": L1, "extra": {"seller": "Amazon México"}})
    s.outbox_delete([p.seq])
    assert s.outbox_size() == 0
    s.close()
