"""Start: settings, logging, the loops, and a clean stop on SIGTERM (07 §2)."""

import asyncio
import signal
from collections.abc import Awaitable, Callable

from maunedas_agent import __version__, log
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.context import AgentContext
from maunedas_agent.loops.flush import flush_once
from maunedas_agent.loops.poll import poll_once
from maunedas_agent.loops.scrape import scrape_once
from maunedas_agent.store import Store

logger = log.get("agent")


async def every(
    seconds: float, step: Callable[[], Awaitable[object]], stop: asyncio.Event, name: str
) -> None:
    """Runs `step` now and then every `seconds` until `stop`; a failure is logged and the loop goes on."""
    while not stop.is_set():
        try:
            await step()
        except Exception as e:  # noqa: BLE001 - a loop must survive any one failure
            logger.exception("loop_failed", loop=name, error=str(e))
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except TimeoutError:
            pass


async def run(settings: Settings, stop: asyncio.Event) -> None:
    store = Store(settings.db_path)
    api = AgentApi(settings)
    ctx = AgentContext(settings=settings, store=store, api=api)
    logger.info("agent_started", version=__version__, agent_id=settings.agent_id, db=str(settings.db_path))
    loops = [
        asyncio.create_task(every(settings.poll_interval_s, lambda: poll_once(ctx), stop, "poll")),
        asyncio.create_task(every(settings.scrape_tick_s, lambda: scrape_once(ctx), stop, "scrape")),
        asyncio.create_task(every(settings.scrape_tick_s, lambda: flush_once(ctx), stop, "flush")),
    ]
    try:
        await stop.wait()
    finally:
        # A loop waiting on the network stops there; SQLite work is synchronous, so no transaction is cut.
        for task in loops:
            task.cancel()
        await asyncio.gather(*loops, return_exceptions=True)
        await ctx.aclose()
        store.close()
        logger.info("agent_stopped")


def main() -> None:
    settings = Settings()  # type: ignore[call-arg]  # read from the environment
    log.setup(settings.log_level)

    async def start() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)
        await run(settings, stop)

    asyncio.run(start())


if __name__ == "__main__":
    main()
