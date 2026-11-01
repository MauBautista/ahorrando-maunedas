"""Client of the Worker's /agent/v1 (07 §5): bearer token, retries on network errors and 5xx/429 only."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from maunedas_agent import __version__
from maunedas_agent.config import Settings

ATTEMPTS = 3
RETRY_DELAYS_S = (2.0, 8.0)


class ApiError(Exception):
    def __init__(self, status: int, code: str | None) -> None:
        super().__init__(f"HTTP {status}" + (f" {code}" if code else ""))
        self.status = status
        self.code = code


def _retryable(status: int) -> bool:
    return status >= 500 or status == 429


class AgentApi:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._sleep = sleep
        self._client = httpx.AsyncClient(
            base_url=settings.api_base.rstrip("/"),
            headers={
                "Authorization": f"Bearer {settings.agent_token.get_secret_value()}",
                "User-Agent": f"maunedas-agent/{__version__}",
            },
            timeout=settings.http_timeout_s,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(ATTEMPTS):
            last = attempt == ATTEMPTS - 1
            try:
                res = await self._client.post(path, json=body)
            except httpx.TransportError:
                if last:
                    raise
            else:
                if res.is_success:
                    return res.json() if res.content else {}
                if last or not _retryable(res.status_code):
                    raise ApiError(res.status_code, _error_code(res))
            await self._sleep(RETRY_DELAYS_S[attempt])
        raise AssertionError("unreachable")

    async def work(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self.post("/agent/v1/work", body)

    async def observations(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        return await self.post("/agent/v1/observations", {"results": results})

    async def backup_pull(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self.post("/agent/v1/backup/pull", body)


def _error_code(res: httpx.Response) -> str | None:
    try:
        code = res.json()["error"]["code"]
    except (ValueError, KeyError, TypeError):
        return None
    return code if isinstance(code, str) else None
