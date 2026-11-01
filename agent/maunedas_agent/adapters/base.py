"""What an adapter is and what it returns (07 §9)."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from maunedas_agent.config import Settings
from maunedas_agent.fetch.browser import BrowserFetcher
from maunedas_agent.fetch.http import HttpFetcher

Status = Literal["ok", "not_found", "blocked", "error"]


@dataclass
class ScrapeResult:
    status: Status
    price_cents: int | None = None
    list_price_cents: int | None = None
    in_stock: bool | None = None
    promo_text: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass
class FetchContext:
    """What adapters get to download a page."""

    settings: Settings
    http: HttpFetcher
    # Chromium as the last resort (07 §8.2); None with PLAYWRIGHT_ENABLED off or Playwright not installed.
    browser: BrowserFetcher | None = None
    # Waits until the adapter's domain can take one more request (rule 10).
    wait_turn: Callable[[Any], Awaitable[None]] | None = None


class Adapter(Protocol):
    name: str
    domains: tuple[str, ...]
    gate_key: str
    min_spacing_s: int
    needs_browser: bool

    async def fetch(self, url: str, ctx: FetchContext) -> ScrapeResult: ...
