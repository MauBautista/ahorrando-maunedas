"""Chromium as the last resort (07 §8.2): a persistent context, one page at a time, restarted by pages or RAM.

Playwright is the image's `browser` extra; without it (tests, CI) the fetcher simply never starts.
"""

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Protocol

from maunedas_agent import log
from maunedas_agent.config import Settings
from maunedas_agent.fetch.http import Page

# Restart Chromium when its processes go past this (spike B: 626–759 MB per page).
MAX_RSS_MB = 900
BLOCKED_RESOURCES = frozenset({"image", "font", "media"})
ANALYTICS = (
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "facebook.net",
    "hotjar.com",
    "amazon-adsystem.com",
)

logger = log.get("browser")


class BrowserContext(Protocol):
    async def new_page(self) -> Any: ...


# Starts Chromium; returns the context and how to stop everything.
Launcher = Callable[[Settings], Awaitable[tuple[BrowserContext, Callable[[], Awaitable[None]]]]]


def descendants_rss_mb(root: int | None = None, proc: Path = Path("/proc")) -> float:
    """Resident memory of every process below `root` (Chromium's), from /proc; 0 where it does not exist."""
    root = os.getpid() if root is None else root
    parents: dict[int, int] = {}
    rss: dict[int, int] = {}
    for entry in proc.iterdir() if proc.exists() else []:
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
            # The command name may hold spaces: fields start after its closing parenthesis.
            fields = stat[stat.rindex(")") + 2 :].split()
            parents[int(entry.name)] = int(fields[1])
            rss[int(entry.name)] = int(fields[21]) * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError, IndexError):
            continue
    below: set[int] = set()
    frontier = {root}
    while frontier:
        children = {pid for pid, parent in parents.items() if parent in frontier and pid not in below}
        below |= children
        frontier = children
    return round(sum(rss.get(pid, 0) for pid in below) / 1_048_576, 1)


async def _route(route: Any) -> None:
    request = route.request
    if request.resource_type in BLOCKED_RESOURCES or any(d in request.url for d in ANALYTICS):
        await route.abort()
    else:
        await route.continue_()


async def launch_chromium(settings: Settings) -> tuple[BrowserContext, Callable[[], Awaitable[None]]]:
    from playwright.async_api import async_playwright  # the image's `browser` extra

    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        str(settings.data_dir / "browser-profile"),
        headless=True,
        user_agent=settings.chrome_ua,
        locale="es-MX",
        timezone_id=settings.tz,
        args=["--disable-dev-shm-usage"],
    )
    await context.route("**/*", _route)

    async def stop() -> None:
        await context.close()
        await pw.stop()

    return context, stop


class BrowserFetcher:
    def __init__(
        self,
        settings: Settings,
        launcher: Launcher = launch_chromium,
        rss: Callable[[], float] = descendants_rss_mb,
    ) -> None:
        self._settings = settings
        self._launcher = launcher
        self._rss = rss
        self._lock = asyncio.Lock()
        self._context: BrowserContext | None = None
        self._stop: Callable[[], Awaitable[None]] | None = None
        self.pages = 0
        self.restarts = 0

    async def _restart(self, reason: str) -> None:
        await self._close()
        self._context, self._stop = await self._launcher(self._settings)
        self.pages = 0
        self.restarts += 1
        logger.info("browser_started", reason=reason)

    async def _close(self) -> None:
        if self._stop is not None:
            try:
                await self._stop()
            except Exception as e:  # noqa: BLE001 - a dead browser is closed anyway
                logger.warning("browser_close_failed", error=str(e))
        self._context, self._stop = None, None

    async def get(self, url: str, wait_for: str | None = None) -> Page:
        """The page after `domcontentloaded` and, if given, once `wait_for` shows up or the timeout passes."""
        async with self._lock:
            if self._context is None:
                await self._restart("first")
            elif self.pages >= self._settings.browser_restart_every:
                await self._restart("pages")
            elif self._rss() > MAX_RSS_MB:
                await self._restart("memory")
            assert self._context is not None
            started = time.monotonic()
            timeout_ms = self._settings.browser_timeout_s * 1000
            page = await self._context.new_page()
            try:
                response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                if wait_for:
                    try:
                        await page.wait_for_selector(wait_for, timeout=timeout_ms)
                    except Exception:  # noqa: BLE001 - a missing price is the adapter's call
                        pass
                html = await page.content()
                final = page.url
            finally:
                self.pages += 1
                await page.close()
            status = response.status if response is not None else 0
            return Page(status, final, html, round((time.monotonic() - started) * 1000))

    async def aclose(self) -> None:
        async with self._lock:
            await self._close()
