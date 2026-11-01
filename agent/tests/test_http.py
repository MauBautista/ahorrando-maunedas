import json
from pathlib import Path

import httpx
import respx

from maunedas_agent.config import Settings
from maunedas_agent.fetch.http import COOKIES_KEY, HttpFetcher, dump_cookies, load_cookies
from maunedas_agent.store import Store


@respx.mock
async def test_gets_a_page_with_browser_headers_following_redirects(settings: Settings, store: Store) -> None:
    respx.get("https://www.costco.com.mx/p/1").respond(301, headers={"Location": "/Leche/p/1"})
    route = respx.get("https://www.costco.com.mx/Leche/p/1").respond(200, html="<title>Leche</title>")
    fetcher = HttpFetcher(settings, store)
    page = await fetcher.get("https://www.costco.com.mx/p/1")
    await fetcher.aclose()
    assert (page.status, page.url, page.html) == (
        200,
        "https://www.costco.com.mx/Leche/p/1",
        "<title>Leche</title>",
    )
    assert page.ms >= 0
    headers = route.calls.last.request.headers
    assert headers["User-Agent"] == settings.chrome_ua and "Chrome/" in headers["User-Agent"]
    assert headers["Accept-Language"].startswith("es-MX")
    assert "text/html" in headers["Accept"]


@respx.mock
async def test_cookies_survive_a_restart_per_domain(settings: Settings, tmp_path: Path) -> None:
    db = tmp_path / "c.sqlite"
    store = Store(db)
    respx.get("https://www.sams.com.mx/ip/x/1").respond(
        200, headers=[("Set-Cookie", "club=4919; Path=/"), ("Set-Cookie", "old=1; Path=/; Max-Age=0")]
    )
    first = HttpFetcher(settings, store)
    await first.get("https://www.sams.com.mx/ip/x/1")
    await first.aclose()
    assert "4919" in (store.get(COOKIES_KEY) or "")
    assert '"old"' not in (store.get(COOKIES_KEY) or "")
    store.close()

    store = Store(db)
    sams = respx.get("https://www.sams.com.mx/ip/x/2").respond(200)
    costco = respx.get("https://www.costco.com.mx/p/2").respond(200)
    again = HttpFetcher(settings, store)
    await again.get("https://www.sams.com.mx/ip/x/2")
    await again.get("https://www.costco.com.mx/p/2")
    await again.aclose()
    assert sams.calls.last.request.headers["Cookie"] == "club=4919"
    assert "Cookie" not in costco.calls.last.request.headers
    store.close()


def test_cookies_that_expired_while_kept_are_dropped() -> None:
    kept = [
        {
            "name": "club",
            "value": "4919",
            "domain": "www.sams.com.mx",
            "path": "/",
            "secure": True,
            "expires": None,
        },
        {"name": "old", "value": "1", "domain": ".sams.com.mx", "path": "/", "secure": False, "expires": 1},
        {
            "name": "cp",
            "value": "72750",
            "domain": ".amazon.com.mx",
            "path": "/",
            "secure": True,
            "expires": 4_000_000_000,
        },
    ]
    again = json.loads(dump_cookies(load_cookies(json.dumps(kept))))
    assert sorted(c["name"] for c in again) == ["club", "cp"]
    assert next(c for c in again if c["name"] == "cp") == kept[2]


@respx.mock
async def test_network_errors_reach_the_adapter(settings: Settings, store: Store) -> None:
    respx.get("https://www.amazon.com.mx/dp/B0").mock(side_effect=httpx.ConnectTimeout("slow"))
    fetcher = HttpFetcher(settings, store)
    try:
        await fetcher.get("https://www.amazon.com.mx/dp/B0")
    except httpx.ConnectTimeout:
        pass
    else:
        raise AssertionError("expected a timeout")
    finally:
        await fetcher.aclose()
