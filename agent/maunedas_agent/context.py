"""What the loops share."""

import asyncio
import importlib.util
from dataclasses import dataclass, field
from typing import Any

from maunedas_agent.adapters.base import FetchContext
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.fetch.browser import BrowserFetcher
from maunedas_agent.fetch.gate import DomainGate, spacing_for
from maunedas_agent.fetch.http import HttpFetcher
from maunedas_agent.store import Store, now_ms

# How often a request waiting for its domain checks the gate again.
TURN_POLL_S = 1.0


@dataclass
class AgentContext:
    settings: Settings
    store: Store
    api: AgentApi
    # Last failure of any loop, reported in /work's info until a poll succeeds.
    last_error: str | None = None
    gate: DomainGate = field(init=False)
    http_sem: asyncio.Semaphore = field(init=False)
    browser_sem: asyncio.Semaphore = field(init=False)
    fetch: FetchContext = field(init=False)

    def __post_init__(self) -> None:
        self.gate = DomainGate(self.store)
        self.http_sem = asyncio.Semaphore(self.settings.max_http_concurrency)
        self.browser_sem = asyncio.Semaphore(self.settings.max_browser_concurrency)
        browser = None
        if self.settings.playwright_enabled and importlib.util.find_spec("playwright") is not None:
            browser = BrowserFetcher(self.settings)
        self.fetch = FetchContext(
            settings=self.settings,
            http=HttpFetcher(self.settings, self.store),
            browser=browser,
            wait_turn=self.wait_turn,
        )

    async def wait_turn(self, adapter: Any) -> None:
        """Takes the adapter's domain as soon as its spacing allows another request."""
        spacing = spacing_for(adapter, self.store.min_spacing())
        while not self.gate.try_acquire(adapter.gate_key, spacing, now_ms()):
            await asyncio.sleep(TURN_POLL_S)

    async def aclose(self) -> None:
        if self.fetch.browser is not None:
            await self.fetch.browser.aclose()
        await self.fetch.http.aclose()
        await self.api.aclose()
