"""The image container's loop (07 §5.3, §11): claim a job, cut its photo, upload three results, complete."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from maunedas_agent import log
from maunedas_agent.api import AgentApi, ApiError
from maunedas_agent.images.remove_bg import Cutter, render

logger = log.get("images")


class ImageWorker:
    """One job at a time; the model is loaded once, on the first job (07 §11)."""

    def __init__(
        self,
        api: AgentApi,
        cutter_factory: Callable[[], Cutter],
        heartbeat: Path,
        idle_s: float = 60,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._api = api
        self._factory = cutter_factory
        self._cutter: Cutter | None = None
        self._heartbeat = heartbeat
        self._idle_s = idle_s
        self._sleep = sleep

    def _cut(self) -> Cutter:
        if self._cutter is None:
            self._cutter = self._factory()
        return self._cutter

    async def run_once(self) -> bool:
        """True when it handled a job; false when there was none."""
        job = await self._api.claim_job()
        if job is None:
            return False
        started = time.monotonic()
        try:
            original = await self._api.get_bytes(job["original_url"])
            cutter = await asyncio.to_thread(self._cut)
            rendered = await asyncio.to_thread(render, original, cutter)
            if rendered is None:
                raise ValueError("no se encontró el producto en la foto")
            for kind in ("mask", "processed", "thumb"):
                await self._api.put_result(job["id"], kind, getattr(rendered, kind))
            await self._api.complete_job(job["id"])
            logger.info("image_done", job=job["id"], s=round(time.monotonic() - started, 1))
        except ApiError as e:
            if e.status != 404:
                raise
            # The lease ran out or the job ended: it is no longer ours, and another claim takes it.
            logger.warning("image_lost", job=job["id"])
        except Exception as e:  # noqa: BLE001 — any failure of the photo goes back to the Worker
            message = f"{type(e).__name__}: {e}"[:500]
            logger.warning("image_failed", job=job["id"], error=message)
            try:
                await self._api.fail_job(job["id"], message)
            except ApiError as lost:
                if lost.status != 404:
                    raise
        return True

    async def run(self) -> None:
        while True:
            self._heartbeat.touch()
            try:
                busy = await self.run_once()
            except Exception as e:  # noqa: BLE001 — the Worker or the network may be down; try again later
                logger.warning("images_unreachable", error=str(e)[:200])
                busy = False
            if not busy:
                await self._sleep(self._idle_s)
