"""The common path of an adapter (07 §9): HTTP, block check, then the store's own reading (browser: T-204)."""

import re
import secrets
import time
from pathlib import Path

from selectolax.lexbor import LexborHTMLParser

from maunedas_agent import log
from maunedas_agent.adapters.base import FetchContext, ScrapeResult
from maunedas_agent.extract.blocks import is_blocked
from maunedas_agent.extract.html import parse
from maunedas_agent.fetch.http import Page
from maunedas_agent.urls import CanonicalListing, canonical_listing

NOT_FOUND = frozenset({404, 410})
# Pages that could not be read, kept to turn them into fixtures (07 §2); the newest ones only.
FAILURES_KEPT = 20
NO_PRICE = "no se encontró el precio en la página"

logger = log.get("adapter")


def clean(text: str | None) -> str | None:
    """Text of the page with its whitespace collapsed; None when empty."""
    if text is None:
        return None
    t = re.sub(r"\s+", " ", text).strip()
    return t or None


class BaseAdapter:
    name = ""
    domains: tuple[str, ...] = ()
    min_spacing_s = 20
    needs_browser = False
    # Lowercase markers of this store's block page, counted like the strong ones (07 §8.4).
    block_markers: tuple[str, ...] = ()

    @property
    def gate_key(self) -> str:
        return self.name

    def canonicalize(self, url: str) -> CanonicalListing | None:
        listing = canonical_listing(url)
        return listing if listing is not None and listing.adapter == self.name else None

    async def fetch(self, url: str, ctx: FetchContext) -> ScrapeResult:
        page = await ctx.http.get(url)
        result = self.read(page)
        result.extra.setdefault("http_status", page.status)
        if result.status == "error" and result.error == NO_PRICE:
            save_failure(ctx.settings.data_dir, self.name, page.html)
        return result

    def read(self, page: Page) -> ScrapeResult:
        """A downloaded page to a result; what the fixture tests exercise."""
        tree = parse(page.html)
        if is_blocked(page.status, page.html, page.url, tree, self.block_markers):
            return ScrapeResult("blocked", extra={"method": "http"})
        if page.status in NOT_FOUND:
            return ScrapeResult("not_found", extra={"method": "http"})
        if page.status >= 400:
            return ScrapeResult("error", extra={"method": "http"}, error=f"HTTP {page.status}")
        return self.extract(tree) or ScrapeResult("error", extra={"method": "http"}, error=NO_PRICE)

    def extract(self, tree: LexborHTMLParser) -> ScrapeResult | None:
        """The store's reading of a product page; None when neither price nor stock could be read."""
        raise NotImplementedError


def save_failure(data_dir: Path, adapter: str, html: str) -> None:
    folder = data_dir / "fallos" / adapter
    try:
        folder.mkdir(parents=True, exist_ok=True)
        # Nanoseconds sort by age; the random part keeps two pages of the same instant apart.
        (folder / f"{time.time_ns()}-{secrets.token_hex(3)}.html").write_text(html, encoding="utf-8")
        for old in sorted(folder.glob("*.html"))[:-FAILURES_KEPT]:
            old.unlink()
    except OSError as e:
        logger.warning("failure_not_saved", adapter=adapter, error=str(e))
