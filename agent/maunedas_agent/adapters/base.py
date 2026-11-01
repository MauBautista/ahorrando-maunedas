"""What an adapter is and what it returns (07 §9)."""

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from maunedas_agent.config import Settings

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
    """What adapters get to download a page; the HTTP client and the browser arrive with T-203 and T-204."""

    settings: Settings


class Adapter(Protocol):
    name: str
    domains: tuple[str, ...]
    gate_key: str
    min_spacing_s: int
    needs_browser: bool

    async def fetch(self, url: str, ctx: FetchContext) -> ScrapeResult: ...
