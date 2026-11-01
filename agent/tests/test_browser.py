import asyncio
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from maunedas_agent.adapters.base import FetchContext
from maunedas_agent.adapters.common import NO_PRICE
from maunedas_agent.adapters.registry import ADAPTERS
from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.context import AgentContext
from maunedas_agent.fetch.browser import MAX_RSS_MB, BrowserFetcher, descendants_rss_mb
from maunedas_agent.fetch.http import Page
from maunedas_agent.store import Store

FIXTURES = Path(__file__).parent / "fixtures" / "html"


@dataclass
class FakeResponse:
    status: int


@dataclass
class FakePage:
    browser: "FakeBrowser"
    url: str = "about:blank"
    closed: bool = False

    async def goto(self, url: str, wait_until: str, timeout: float) -> FakeResponse:
        self.browser.calls.append(("goto", url, wait_until, timeout))
        self.browser.open_pages += 1
        self.browser.max_open = max(self.browser.max_open, self.browser.open_pages)
        await asyncio.sleep(0.01)
        if self.browser.fail_goto:
            raise RuntimeError("net::ERR_TIMED_OUT")
        self.url = url + "#final"
        return FakeResponse(200)

    async def wait_for_selector(self, selector: str, timeout: float) -> None:
        self.browser.calls.append(("wait", selector, timeout))
        if self.browser.selector_missing:
            raise TimeoutError("selector")

    async def content(self) -> str:
        return self.browser.html

    async def close(self) -> None:
        self.closed = True
        self.browser.open_pages -= 1


@dataclass
class FakeBrowser:
    html: str = "<html><title>ok</title></html>"
    calls: list = field(default_factory=list)
    launches: int = 0
    stops: int = 0
    open_pages: int = 0
    max_open: int = 0
    fail_goto: bool = False
    selector_missing: bool = False
    pages: list = field(default_factory=list)

    async def new_page(self) -> FakePage:
        page = FakePage(self)
        self.pages.append(page)
        return page

    async def launcher(self, settings: Settings):
        self.launches += 1

        async def stop() -> None:
            self.stops += 1

        return self, stop


@pytest.fixture
def fake() -> FakeBrowser:
    return FakeBrowser()


def fetcher(
    settings: Settings, fake: FakeBrowser, rss: list[float] | None = None, every: int = 3
) -> BrowserFetcher:
    s = settings.model_copy(update={"browser_restart_every": every, "browser_timeout_s": 2})
    memory = rss if rss is not None else [0.0]
    return BrowserFetcher(s, launcher=fake.launcher, rss=lambda: memory[0])


async def test_starts_on_first_use_and_restarts_every_n_pages(settings: Settings, fake: FakeBrowser) -> None:
    b = fetcher(settings, fake)
    assert fake.launches == 0
    pages = [await b.get(f"https://x.test/{i}", "#price") for i in range(7)]
    assert pages[0] == Page(200, "https://x.test/0#final", fake.html, pages[0].ms)
    # 3 pages per Chromium: started for pages 1, 4 and 7.
    assert (fake.launches, fake.stops, b.restarts, b.pages) == (3, 2, 3, 1)
    assert ("goto", "https://x.test/0", "domcontentloaded", 2000) in fake.calls
    assert ("wait", "#price", 2000) in fake.calls
    assert all(p.closed for p in fake.pages)
    await b.aclose()
    assert fake.stops == 3


async def test_restarts_when_chromium_uses_too_much_memory(settings: Settings, fake: FakeBrowser) -> None:
    rss = [100.0]
    b = fetcher(settings, fake, rss, every=50)
    await b.get("https://x.test/1")
    await b.get("https://x.test/2")
    assert fake.launches == 1
    rss[0] = MAX_RSS_MB + 1
    await b.get("https://x.test/3")
    assert (fake.launches, fake.stops, b.pages) == (2, 1, 1)
    rss[0] = MAX_RSS_MB
    await b.get("https://x.test/4")
    assert fake.launches == 2
    await b.aclose()


async def test_one_page_at_a_time_and_pages_always_closed(settings: Settings, fake: FakeBrowser) -> None:
    b = fetcher(settings, fake, every=50)
    await asyncio.gather(*(b.get(f"https://x.test/{i}") for i in range(5)))
    assert fake.max_open == 1
    fake.fail_goto = True
    with pytest.raises(RuntimeError):
        await b.get("https://x.test/broken")
    assert fake.pages[-1].closed and b.pages == 6
    # A selector that never shows up is the adapter's business: the page still comes back.
    fake.fail_goto = False
    fake.selector_missing = True
    assert (await b.get("https://x.test/slow", "#price")).html == fake.html
    await b.aclose()


async def test_a_failing_stop_does_not_keep_the_old_browser(settings: Settings, fake: FakeBrowser) -> None:
    async def launcher(s: Settings):
        await fake.launcher(s)

        async def stop() -> None:
            raise RuntimeError("already dead")

        return fake, stop

    b = BrowserFetcher(
        settings.model_copy(update={"browser_restart_every": 1}), launcher=launcher, rss=lambda: 0
    )
    await b.get("https://x.test/1")
    await b.get("https://x.test/2")
    assert fake.launches == 2
    await b.aclose()


def test_descendants_rss_reads_the_process_tree(tmp_path: Path) -> None:
    page = os.sysconf("SC_PAGE_SIZE")

    def proc(pid: int, parent: int, pages: int, name: str = "chrome") -> None:
        (tmp_path / str(pid)).mkdir()
        rest = ["S", str(parent)] + ["0"] * 19 + [str(pages)] + ["0"] * 10
        (tmp_path / str(pid) / "stat").write_text(f"{pid} ({name}) {' '.join(rest)}\n")

    proc(10, 1, 1000, "python")
    proc(11, 10, 256 * 1024 * 1024 // page, "chrome (zygote)")
    proc(12, 11, 128 * 1024 * 1024 // page, "chrome) x (renderer")
    proc(13, 1, 999_999, "other")
    (tmp_path / "self").mkdir()
    (tmp_path / "14").mkdir()  # gone between listing and reading
    assert descendants_rss_mb(10, tmp_path) == 384.0
    assert descendants_rss_mb(13, tmp_path) == 0.0
    assert descendants_rss_mb(10, tmp_path / "missing") == 0.0
    assert descendants_rss_mb() >= 0.0


class FakeFetch:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.urls: list[tuple[str, str | None]] = []

    async def get(self, url: str, wait_for: str | None = None) -> Page:
        self.urls.append((url, wait_for))
        return self.page


async def test_adapters_use_the_browser_only_for_a_page_without_price(settings: Settings) -> None:
    turns: list[str] = []

    async def wait_turn(adapter) -> None:
        turns.append(adapter.gate_key)

    def fc(http: FakeFetch, browser: FakeFetch | None) -> FetchContext:
        return FetchContext(settings, http=http, browser=browser, wait_turn=wait_turn)  # type: ignore[arg-type]

    url = "https://www.costco.com.mx/p/6262016"
    empty = FakeFetch(Page(200, url, "<html><title>Costco</title></html>", 1))
    good = FakeFetch(Page(200, url, (FIXTURES / "costco_mx/ok.html").read_text(), 1))
    costco = ADAPTERS["costco_mx"]
    r = await costco.fetch(url, fc(empty, good))
    assert (r.status, r.price_cents, r.extra["method"]) == ("ok", 52900, "browser_jsonld")
    assert good.urls == [(url, costco.price_selector)] and turns == ["costco_mx"]
    # Still unreadable in the browser: the same error.
    r = await costco.fetch(url, fc(empty, empty))
    assert (r.status, r.error, r.extra["method"]) == ("error", NO_PRICE, "browser")
    # Never for a block (rule 10) nor for a good page; without a browser nothing changes.
    blocked = FakeFetch(Page(200, url, (FIXTURES / "walmart_mx/bloqueo.html").read_text(), 1))
    spare = FakeFetch(Page(200, url, "", 1))
    assert (await costco.fetch(url, fc(blocked, spare))).status == "blocked"
    assert (await costco.fetch(url, fc(good, spare))).extra["method"] == "http_jsonld"
    assert spare.urls == []
    r = await costco.fetch(url, fc(empty, None))
    assert (r.status, r.extra["method"]) == ("error", "http")
    assert turns == ["costco_mx", "costco_mx"]


async def test_waiting_for_a_turn_respects_the_domain_spacing(settings: Settings, store: Store) -> None:
    off = settings.model_copy(update={"playwright_enabled": False})
    c = AgentContext(settings=off, store=store, api=AgentApi(off))
    assert c.fetch.browser is None and c.fetch.wait_turn is not None
    # The Worker's spacing applies here too.
    store.put("min_spacing_s", json.dumps({"default": 1}))
    adapter = type("Adapter", (), {"gate_key": "sams_mx", "min_spacing_s": 0})()
    loop = asyncio.get_running_loop()
    start = loop.time()
    await c.wait_turn(adapter)
    await c.wait_turn(adapter)
    assert loop.time() - start >= 0.9
    await c.aclose()


def test_the_browser_is_off_without_playwright(settings: Settings, store: Store) -> None:
    # The dev environment and CI install no `browser` extra.
    c = AgentContext(settings=settings, store=store, api=AgentApi(settings))
    assert c.fetch.browser is None
    asyncio.run(c.aclose())
