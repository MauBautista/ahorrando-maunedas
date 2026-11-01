"""What the loops share."""

import asyncio
from dataclasses import dataclass, field

from maunedas_agent.adapters.base import FetchContext
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.fetch.gate import DomainGate
from maunedas_agent.fetch.http import HttpFetcher
from maunedas_agent.store import Store


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
        self.fetch = FetchContext(settings=self.settings, http=HttpFetcher(self.settings, self.store))

    async def aclose(self) -> None:
        await self.fetch.http.aclose()
        await self.api.aclose()
