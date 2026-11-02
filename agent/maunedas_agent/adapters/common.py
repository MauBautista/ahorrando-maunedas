"""The common path of an adapter (07 §9): HTTP, block check, then the store's own reading (browser: T-204)."""

import hashlib
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
# Pages with a list price, kept as future fixtures (`con precio de lista`, T-205): the first ones per store.
SAMPLES_KEPT = 5
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
    # What the browser waits for before reading the page.
    price_selector: str | None = None

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
            # Last resort: only for a page that loaded without a price, never for a block (rule 10), and only
            # once the domain can take another request.
            if ctx.browser is not None and ctx.wait_turn is not None:
                await ctx.wait_turn(self)
                page = await ctx.browser.get(url, self.price_selector)
                result = self.read(page)
                result.extra["method"] = str(result.extra.get("method", "http")).replace("http", "browser", 1)
                result.extra.setdefault("http_status", page.status)
        if result.status == "ok" and result.list_price_cents is not None:
            keep_sample(ctx.settings.data_dir, self.name, url, page.html)
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


def keep_sample(data_dir: Path, adapter: str, url: str, html: str) -> None:
    """A page with a list price, once per URL and up to [SAMPLES_KEPT] per store, under `/data/muestras/`."""
    folder = data_dir / "muestras" / adapter
    target = folder / f"{hashlib.sha256(url.encode()).hexdigest()[:16]}.html"
    try:
        if target.exists() or (folder.exists() and len(list(folder.glob("*.html"))) >= SAMPLES_KEPT):
            return
        folder.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")
        logger.info("sample_kept", adapter=adapter, file=target.name)
    except OSError as e:
        logger.warning("sample_not_saved", adapter=adapter, error=str(e))


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
