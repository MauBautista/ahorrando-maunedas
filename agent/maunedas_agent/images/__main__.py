"""`python -m maunedas_agent.images`: the image container's entry point (T-300, decisión T105)."""

import asyncio

from maunedas_agent import log
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.images.health import HEARTBEAT
from maunedas_agent.images.remove_bg import rembg_cutter
from maunedas_agent.images.worker import ImageWorker


async def main() -> None:
    settings = Settings()
    log.setup(settings.log_level)
    logger = log.get("images")
    heartbeat = settings.data_dir / HEARTBEAT
    if not settings.images_enabled:
        # Kept alive and healthy, so a disabled container does not restart over and over.
        logger.info("images_disabled")
        while True:
            heartbeat.touch()
            await asyncio.sleep(60)
    api = AgentApi(settings)
    logger.info("images_started", model=settings.rembg_model)
    try:
        await ImageWorker(
            api, lambda: rembg_cutter(settings.rembg_model), heartbeat, settings.images_idle_s
        ).run()
    finally:
        await api.aclose()


if __name__ == "__main__":
    asyncio.run(main())
