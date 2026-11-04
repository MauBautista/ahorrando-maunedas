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

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        for attempt in range(ATTEMPTS):
            last = attempt == ATTEMPTS - 1
            try:
                res = await self._client.request(method, path, **kwargs)
            except httpx.TransportError:
                if last:
                    raise
            else:
                if res.is_success:
                    return res
                if last or not _retryable(res.status_code):
                    raise ApiError(res.status_code, _error_code(res))
            await self._sleep(RETRY_DELAYS_S[attempt])
        raise AssertionError("unreachable")

    async def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        res = await self._request("POST", path, json=body)
        return res.json() if res.content else {}

    async def work(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self.post("/agent/v1/work", body)

    async def observations(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        return await self.post("/agent/v1/observations", {"results": results})

    async def backup_pull(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self.post("/agent/v1/backup/pull", body)

    # Image jobs (07 §5.3)

    async def claim_job(self) -> dict[str, Any] | None:
        """The job to do, or None (`204`)."""
        return (await self.post("/agent/v1/jobs/claim", {})).get("job")

    async def get_bytes(self, path: str) -> bytes:
        return (await self._request("GET", path)).content

    async def put_result(self, job_id: str, kind: str, rendition: Any) -> str:
        """Uploads one result (`mask` as PNG, the rest as WebP) with its size; returns the rendition id."""
        res = await self._request(
            "PUT",
            f"/agent/v1/jobs/{job_id}/result/{kind}",
            params={"width": rendition.width, "height": rendition.height},
            content=rendition.data,
            headers={"Content-Type": "image/png" if kind == "mask" else "image/webp"},
        )
        return str(res.json()["rendition_id"])

    async def complete_job(self, job_id: str) -> None:
        await self.post(f"/agent/v1/jobs/{job_id}/complete", {})

    async def fail_job(self, job_id: str, error: str) -> None:
        await self.post(f"/agent/v1/jobs/{job_id}/fail", {"error": error})


def _error_code(res: httpx.Response) -> str | None:
    try:
        code = res.json()["error"]["code"]
    except (ValueError, KeyError, TypeError):
        return None
    return code if isinstance(code, str) else None
