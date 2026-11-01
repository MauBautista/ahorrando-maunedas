"""Store pages over HTTP (07 §8.1): browser headers; cookies (branch, postal code) kept across restarts."""

import http.cookiejar
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from maunedas_agent.config import Settings
from maunedas_agent.store import Store

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.6",
}
COOKIES_KEY = "http_cookies"


@dataclass(frozen=True)
class Page:
    status: int
    # After redirects.
    url: str
    html: str
    ms: int


def dump_cookies(cookies: httpx.Cookies) -> str:
    return json.dumps(
        [
            {
                "name": c.name,
                "value": c.value,
                "domain": c.domain,
                "path": c.path,
                "secure": c.secure,
                "expires": c.expires,
            }
            for c in cookies.jar
            if not c.is_expired()
        ]
    )


def load_cookies(raw: str | None) -> httpx.Cookies:
    cookies = httpx.Cookies()
    for c in json.loads(raw) if raw else []:
        cookies.jar.set_cookie(_cookie(c))
    return cookies


def _cookie(c: dict[str, Any]) -> http.cookiejar.Cookie:
    domain = c["domain"]
    return http.cookiejar.Cookie(
        version=0,
        name=c["name"],
        value=c["value"],
        port=None,
        port_specified=False,
        domain=domain,
        domain_specified=bool(domain),
        domain_initial_dot=domain.startswith("."),
        path=c["path"],
        path_specified=True,
        secure=c["secure"],
        expires=c["expires"],
        discard=c["expires"] is None,
        comment=None,
        comment_url=None,
        rest={},
    )


class HttpFetcher:
    def __init__(
        self, settings: Settings, store: Store, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._store = store
        self._client = httpx.AsyncClient(
            http2=True,
            headers={**HEADERS, "User-Agent": settings.chrome_ua},
            cookies=load_cookies(store.get(COOKIES_KEY)),
            follow_redirects=True,
            timeout=httpx.Timeout(settings.http_timeout_s),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            transport=transport,
        )

    async def get(self, url: str) -> Page:
        started = time.monotonic()
        res = await self._client.get(url)
        self._store.put(COOKIES_KEY, dump_cookies(self._client.cookies))
        return Page(res.status_code, str(res.url), res.text, round((time.monotonic() - started) * 1000))

    async def aclose(self) -> None:
        await self._client.aclose()
