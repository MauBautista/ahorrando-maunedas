import httpx
import pytest
import respx

from maunedas_agent import __version__
from maunedas_agent.api import AgentApi, ApiError
from maunedas_agent.config import Settings
from tests.conftest import API, TOKEN


@pytest.fixture
def slept() -> list[float]:
    return []


@pytest.fixture
async def api(settings: Settings, slept: list[float]):
    async def sleep(s: float) -> None:
        slept.append(s)

    a = AgentApi(settings, sleep=sleep)
    yield a
    await a.aclose()


@respx.mock
async def test_sends_the_token_and_returns_the_answer(api: AgentApi, slept: list[float]) -> None:
    route = respx.post(f"{API}/agent/v1/work").respond(200, json={"ok": True})
    assert await api.work({"a": 1}) == {"ok": True}
    req = route.calls.last.request
    assert req.headers["Authorization"] == f"Bearer {TOKEN}"
    assert req.headers["User-Agent"] == f"maunedas-agent/{__version__}"
    assert req.content == b'{"a":1}'
    assert slept == []


@respx.mock
async def test_retries_server_errors_and_the_network(api: AgentApi, slept: list[float]) -> None:
    route = respx.post(f"{API}/agent/v1/observations").mock(
        side_effect=[
            httpx.ConnectError("down"),
            httpx.Response(503),
            httpx.Response(200, json={"accepted": 1}),
        ]
    )
    assert await api.observations([{"x": 1}]) == {"accepted": 1}
    assert route.call_count == 3
    assert route.calls.last.request.content == b'{"results":[{"x":1}]}'
    assert slept == [2.0, 8.0]


@respx.mock
async def test_gives_up_after_three_attempts(api: AgentApi, slept: list[float]) -> None:
    respx.post(f"{API}/agent/v1/work").respond(429)
    with pytest.raises(ApiError) as e:
        await api.work({})
    assert e.value.status == 429
    assert slept == [2.0, 8.0]
    respx.post(f"{API}/agent/v1/observations").mock(side_effect=httpx.ConnectTimeout("slow"))
    with pytest.raises(httpx.ConnectTimeout):
        await api.observations([])


@respx.mock
async def test_client_errors_are_not_retried(api: AgentApi, slept: list[float]) -> None:
    route = respx.post(f"{API}/agent/v1/work").respond(401, json={"error": {"code": "UNAUTHENTICATED"}})
    with pytest.raises(ApiError) as e:
        await api.work({})
    assert (e.value.status, e.value.code, route.call_count, slept) == (401, "UNAUTHENTICATED", 1, [])
    respx.post(f"{API}/agent/v1/observations").respond(413, text="too big")
    with pytest.raises(ApiError) as e:
        await api.observations([])
    assert (e.value.status, e.value.code) == (413, None)
