"""Spike B (T-011): one polite pass over product pages of the priority stores.

Runs inside an ephemeral Playwright container (see docs/spikes/spike-b-scraping.md). For every URL it
tries plain HTTP first (JSON-LD, embedded state, selectors) and only falls back to a headless browser
when HTTP gives no price. Requests to the same domain are spaced (Amazon 45 s, others 30 s, plus
jitter); a block or captcha is recorded and never retried. Not part of the agent package.

Usage: python scrape_probe.py OUT_DIR
"""

from __future__ import annotations

import json
import random
import re
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import httpx
from selectolax.lexbor import LexborHTMLParser as HTMLParser

CHROME_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": CHROME_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.6",
}
SPACING_S = {"amazon_mx": 45, "walmart_mx": 30, "sams_mx": 30, "costco_mx": 30}

URLS: list[tuple[str, str, str]] = [
    ("amazon_mx", "papel_petalo_18", "https://www.amazon.com.mx/dp/B0D364NN9H"),
    ("amazon_mx", "ariel_downy_3l", "https://www.amazon.com.mx/dp/B078SY7JHR"),
    ("amazon_mx", "ariel_downy_1_2l", "https://www.amazon.com.mx/dp/B0812GFWJ6"),
    (
        "walmart_mx",
        "leche_lala_1_5l",
        "https://www.walmart.com.mx/ip/Leche-Lala-UHT-entera-1-5-l/00750102055073",
    ),
    (
        "walmart_mx",
        "papel_petalo_12",
        "https://www.walmart.com.mx/ip/papel-higienico-petalo-12-rollos-con-234-hojas-dobles-c-u/00750642561780",
    ),
    (
        "walmart_mx",
        "super_papel_petalo_4",
        "https://super.walmart.com.mx/ip/papel-higienico-petalo-4-rollos-de-310-hojas-dobles-c-u/00750642564900",
    ),
    ("sams_mx", "leche_lala_12", "https://www.sams.com.mx/ip/leche-entera-lala-12-pzas-de-1-l-c-u/980034851"),
    ("sams_mx", "papel_petalo_10x4", "https://www.sams.com.mx/ip/productos/980020572"),
    (
        "sams_mx",
        "papel_petalo_6_250m",
        "https://www.sams.com.mx/ip/papel-higienico-kimberly-clark-petalo-6-rollos-de-250-m-c-u/000188399",
    ),
    (
        "costco_mx",
        "papel_kirkland_30",
        "https://www.costco.com.mx/Grocery/Grocery/Higienicos-y-Desechables/Kirkland-Signature-Papel-Higienico-30-pzas/p/6262016",
    ),
    (
        "costco_mx",
        "capsulas_kirkland_152",
        "https://www.costco.com.mx/Grocery/Grocery/Detergentes/"
        "Kirkland-Signature-Ultra-Clean-Capsulas-de-Detergente-Premium-para-Ropa-152-pzas/p/1785666",
    ),
    (
        "costco_mx",
        "leche_santa_clara_6",
        "https://www.costco.com.mx/Grocery/Grocery/Leches-y-Bebidas/Santa-Clara-Leche-Entera-6-pzas-de-1-l/p/668241",
    ),
]

BLOCK_MARKERS = [
    "validatecaptcha",
    "captcha",
    "px-captcha",
    "access denied",
    "robot or human",
    "pardon our interruption",
    "request unsuccessful",
    "are you a robot",
    "verifica que eres humano",
    "introduce los caracteres",
]
LOCATION_MARKERS = [
    "código postal",
    "codigo postal",
    "selecciona tu tienda",
    "elige tu tienda",
    "selecciona tu club",
    "elige tu club",
    "selecciona tu almacén",
    "selecciona un almacén",
    "ingresa tu cp",
    "zipcode",
    "postalcode",
    "storeid",
]
STATE_SCRIPT_IDS = [
    "__NEXT_DATA__",
    "__NUXT_DATA__",
    "serverApp-state",
    "ng-state",
    "storefront-state",
    "__APOLLO_STATE__",
]
STATE_VARS = ["__PRELOADED_STATE__", "__INITIAL_STATE__", "__APOLLO_STATE__", "__NUXT__"]
PRICE_KEYS = {"price", "currentprice", "saleprice", "offerprice", "finalprice", "value", "amount"}
LIST_KEYS = {"wasprice", "listprice", "strikethroughprice", "originalprice", "regularprice", "baseprice"}


@dataclass
class Attempt:
    method: str
    status: int | None = None
    ms: int | None = None
    bytes: int | None = None
    final_url: str | None = None
    blocked: bool = False
    block_marker: str | None = None
    location_markers: list[str] = field(default_factory=list)
    jsonld: dict[str, Any] | None = None
    embedded: dict[str, Any] | None = None
    selectors: dict[str, Any] | None = None
    chromium_rss_mb: float | None = None
    error: str | None = None

    def price_found(self) -> bool:
        return any(
            src and src.get("price") is not None for src in (self.jsonld, self.embedded, self.selectors)
        )


@dataclass
class UrlResult:
    adapter: str
    case: str
    url: str
    attempts: list[Attempt] = field(default_factory=list)


class Gate:
    """Minimum spacing between requests to the same store, with jitter."""

    def __init__(self) -> None:
        self.last: dict[str, float] = {}

    def wait(self, adapter: str) -> None:
        spacing = SPACING_S[adapter] + random.uniform(1, 6)
        elapsed = time.monotonic() - self.last.get(adapter, -1e9)
        if elapsed < spacing:
            time.sleep(spacing - elapsed)
        self.last[adapter] = time.monotonic()


def _iter_ld(node: Any):
    if isinstance(node, list):
        for item in node:
            yield from _iter_ld(item)
    elif isinstance(node, dict):
        yield node
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in node:
                yield from _iter_ld(node[key])


def extract_jsonld(tree: HTMLParser) -> dict[str, Any] | None:
    for script in tree.css('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.text(strip=False) or "null")
        except json.JSONDecodeError:
            continue
        for node in _iter_ld(data):
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            # Costco writes "@type": "product" in lowercase.
            if "product" not in {str(t).lower() for t in types}:
                continue
            offers = node.get("offers")
            offer = offers[0] if isinstance(offers, list) and offers else offers
            if isinstance(offer, dict) and offer.get("@type") == "AggregateOffer":
                price = offer.get("lowPrice") or offer.get("price")
            else:
                price = offer.get("price") if isinstance(offer, dict) else None
            seller = offer.get("seller") if isinstance(offer, dict) else None
            return {
                "name": node.get("name"),
                "price": price,
                "currency": offer.get("priceCurrency") if isinstance(offer, dict) else None,
                "availability": offer.get("availability") if isinstance(offer, dict) else None,
                "seller": seller.get("name") if isinstance(seller, dict) else seller,
                "gtin": node.get("gtin13") or node.get("gtin") or node.get("sku"),
            }
    return None


def _walk_prices(node: Any, path: str, out: list[tuple[str, Any]], depth: int = 0) -> None:
    if depth > 40 or len(out) > 60:
        return
    if isinstance(node, dict):
        for key, value in node.items():
            lower = key.lower()
            if (lower in PRICE_KEYS or lower in LIST_KEYS or "price" in lower) and isinstance(
                value, (int, float, str, dict)
            ):
                if isinstance(value, dict):
                    inner = value.get("price") or value.get("amount") or value.get("value")
                    if isinstance(inner, (int, float, str)):
                        out.append((f"{path}.{key}", inner))
                elif lower != "value" or "price" in path.lower():
                    out.append((f"{path}.{key}", value))
            _walk_prices(value, f"{path}.{key}", out, depth + 1)
    elif isinstance(node, list):
        for i, item in enumerate(node[:50]):
            _walk_prices(item, f"{path}[{i}]", out, depth + 1)


def _main_product(name: str, data: Any) -> dict[str, Any] | None:
    """Walmart-platform pages (Sam's): the page's own product, not the carousels around it."""
    if name != "__NEXT_DATA__" or not isinstance(data, dict):
        return None
    product = data.get("props", {}).get("pageProps", {}).get("initialData", {}).get("data", {}).get("product")
    if not isinstance(product, dict):
        return None
    info = product.get("priceInfo") or {}
    current = (info.get("currentPrice") or {}).get("price")
    was = (info.get("wasPrice") or {}).get("price")
    location = product.get("location") or {}
    return {
        "path": "props.pageProps.initialData.data.product",
        "price": current,
        "list_price": was,
        "availability": product.get("availabilityStatus"),
        "seller": product.get("sellerName"),
        "postal_code": location.get("postalCode"),
        "store_ids": location.get("storeIds"),
    }


def extract_embedded(html: str, tree: HTMLParser) -> dict[str, Any] | None:
    blobs: list[tuple[str, Any]] = []
    for sid in STATE_SCRIPT_IDS:
        node = tree.css_first(f'script[id="{sid}"]')
        if node:
            try:
                blobs.append((sid, json.loads(node.text(strip=False))))
            except json.JSONDecodeError:
                blobs.append((sid, None))
    for var in STATE_VARS:
        match = re.search(rf"window\.{var}\s*=\s*(\{{.*?\}});\s*</script>", html, re.S)
        if match:
            try:
                blobs.append((var, json.loads(match.group(1))))
            except json.JSONDecodeError:
                blobs.append((var, None))
    if not blobs:
        return None
    for name, data in blobs:
        main = _main_product(name, data)
        if main:
            return {"sources": [n for n, _ in blobs], **main}
    found: list[tuple[str, Any]] = []
    for name, data in blobs:
        if data is not None:
            _walk_prices(data, name, found)
    numeric = [(p, v) for p, v in found if _to_number(v) is not None]
    current = next((v for p, v in numeric if re.search(r"current|sale|final|offer", p, re.I)), None)
    listed = next((v for p, v in numeric if re.search(r"was|list|strike|original|regular", p, re.I)), None)
    return {
        "sources": [name for name, _ in blobs],
        "price": current if current is not None else (numeric[0][1] if numeric else None),
        "list_price": listed,
        "sample_paths": [f"{p}={v}" for p, v in numeric[:12]],
    }


def _to_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"\d+(?:[.,]\d+)?", value.replace(",", ""))
        return float(match.group(0)) if match else None
    return None


def _text(tree: HTMLParser, selector: str) -> str | None:
    node = tree.css_first(selector)
    return node.text(strip=True) if node else None


def _availability_text(tree: HTMLParser) -> str | None:
    node = tree.css_first("#availability")
    if not node:
        return None
    for script in node.css("script"):
        script.decompose()
    return re.sub(r"\s+", " ", node.text(strip=True)) or None


def extract_selectors(adapter: str, tree: HTMLParser) -> dict[str, Any] | None:
    if adapter == "amazon_mx":
        core = "#corePriceDisplay_desktop_feature_div"
        result = {
            # "apex-pricetopay" is the price to pay; ".apex-priceperunit-value" is the unit price.
            "price": _text(tree, f"{core} .apex-pricetopay-value .a-offscreen")
            or _text(tree, "#corePrice_feature_div .a-price .a-offscreen"),
            "list_price": _text(tree, f"{core} .basisPrice .a-offscreen"),
            "unit_price": _text(tree, f"{core} .apex-priceperunit-value .a-offscreen"),
            "availability": _availability_text(tree),
            "seller": _text(tree, "#merchantInfoFeature_feature_div .offer-display-feature-text-message")
            or _text(tree, "#sellerProfileTriggerId"),
            "delivery_location": _text(tree, "#glow-ingress-line2"),
            "title": _text(tree, "#productTitle"),
        }
    elif adapter == "costco_mx":
        out_of_stock = tree.css_first("button.outOfStock")
        result = {
            "price": _text(tree, ".product-price-amount"),
            "list_price": None,
            "availability": "Agotado (botón deshabilitado)" if out_of_stock else None,
            "title": _text(tree, "h1"),
        }
    else:
        meta = tree.css_first('meta[itemprop="price"]') or tree.css_first(
            'meta[property="product:price:amount"]'
        )
        result = {
            "price": meta.attributes.get("content") if meta else None,
            "title": _text(tree, "h1"),
        }
    return result if any(result.values()) else None


def analyze(adapter: str, html: str, attempt: Attempt) -> None:
    lower = html.lower()
    tree = HTMLParser(html)
    title_node = tree.css_first("title")
    title = title_node.text().lower() if title_node else ""
    for marker in BLOCK_MARKERS:
        # "captcha" appears in normal pages' scripts; only count it on small pages or in the title.
        if marker in lower and (marker != "captcha" or "captcha" in title or len(html) < 20_000):
            attempt.blocked = True
            attempt.block_marker = marker
            break
    attempt.location_markers = sorted({m for m in LOCATION_MARKERS if m in lower})
    attempt.jsonld = extract_jsonld(tree)
    attempt.embedded = extract_embedded(html, tree)
    attempt.selectors = extract_selectors(adapter, tree)


def fetch_http(client: httpx.Client, adapter: str, url: str, out: Path, case: str) -> Attempt:
    attempt = Attempt(method="http")
    started = time.monotonic()
    try:
        response = client.get(url)
        attempt.status = response.status_code
        attempt.final_url = str(response.url)
        html = response.text
        attempt.bytes = len(response.content)
        (out / adapter).mkdir(parents=True, exist_ok=True)
        (out / adapter / f"{case}.http.html").write_text(html, encoding="utf-8")
        analyze(adapter, html, attempt)
    except httpx.HTTPError as exc:
        attempt.error = f"{type(exc).__name__}: {exc}"
    attempt.ms = int((time.monotonic() - started) * 1000)
    return attempt


class RssSampler(threading.Thread):
    """Peak resident memory of the browser process tree (Chromium + renderers)."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.peak = 0.0
        self.running = True

    def run(self) -> None:
        import psutil

        me = psutil.Process()
        while self.running:
            total = 0
            for child in me.children(recursive=True):
                try:
                    if "chrom" in child.name().lower() or "headless" in child.name().lower():
                        total += child.memory_info().rss
                except psutil.Error:
                    continue
            self.peak = max(self.peak, total / 1_048_576)
            time.sleep(0.2)


def fetch_browser(
    browser_ctx: Any, adapter: str, url: str, out: Path, case: str, sampler: RssSampler
) -> Attempt:
    attempt = Attempt(method="browser")
    started = time.monotonic()
    page = browser_ctx.new_page()
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=40_000)
        attempt.status = response.status if response else None
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:  # noqa: BLE001 - networkidle is best effort
            pass
        attempt.final_url = page.url
        html = page.content()
        attempt.bytes = len(html.encode("utf-8"))
        (out / adapter).mkdir(parents=True, exist_ok=True)
        (out / adapter / f"{case}.browser.html").write_text(html, encoding="utf-8")
        analyze(adapter, html, attempt)
    except Exception as exc:  # noqa: BLE001 - spike: record any failure
        attempt.error = f"{type(exc).__name__}: {exc}"[:300]
    finally:
        page.close()
    attempt.ms = int((time.monotonic() - started) * 1000)
    attempt.chromium_rss_mb = round(sampler.peak, 1)
    return attempt


def interleaved(items: list[UrlResult]) -> list[UrlResult]:
    by_store: dict[str, list[UrlResult]] = {}
    for item in items:
        by_store.setdefault(item.adapter, []).append(item)
    ordered: list[UrlResult] = []
    while any(by_store.values()):
        for queue in by_store.values():
            if queue:
                ordered.append(queue.pop(0))
    return ordered


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    gate = Gate()
    results = [UrlResult(adapter, case, url) for adapter, case, url in URLS]

    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=20, http2=False) as client:
        for item in interleaved(results):
            gate.wait(item.adapter)
            attempt = fetch_http(client, item.adapter, item.url, out, item.case)
            item.attempts.append(attempt)
            print(
                f"[http] {item.adapter}/{item.case}: {attempt.status} {attempt.ms} ms "
                f"price={attempt.price_found()} blocked={attempt.blocked}",
                flush=True,
            )

    pending = [r for r in results if not r.attempts[0].price_found() and not r.attempts[0].blocked]
    if pending:
        from playwright.sync_api import sync_playwright

        sampler = RssSampler()
        sampler.start()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(locale="es-MX", user_agent=CHROME_UA, timezone_id="America/Mexico_City")
            ctx.route(
                "**/*",
                lambda route: (
                    route.abort()
                    if route.request.resource_type in {"image", "font", "media"}
                    else route.continue_()
                ),
            )
            for item in interleaved(pending):
                gate.wait(item.adapter)
                attempt = fetch_browser(ctx, item.adapter, item.url, out, item.case, sampler)
                item.attempts.append(attempt)
                print(
                    f"[browser] {item.adapter}/{item.case}: {attempt.status} {attempt.ms} ms "
                    f"price={attempt.price_found()} blocked={attempt.blocked} rss={attempt.chromium_rss_mb}",
                    flush=True,
                )
            browser.close()
        sampler.running = False

    (out / "results.json").write_text(
        json.dumps([asdict(r) for r in results], ensure_ascii=False, indent=2), encoding="utf-8"
    )


def reanalyze(out_dir: str) -> None:
    """Re-runs the extractors on the pages already saved; makes no request."""
    out = Path(out_dir)
    results = json.loads((out / "results.json").read_text(encoding="utf-8"))
    for result in results:
        for attempt_data in result["attempts"]:
            page = out / result["adapter"] / f"{result['case']}.{attempt_data['method']}.html"
            if not page.exists():
                continue
            attempt = Attempt(**attempt_data)
            analyze(result["adapter"], page.read_text(encoding="utf-8"), attempt)
            attempt_data.update(asdict(attempt))
    (out / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    if "--reanalyze" in sys.argv:
        reanalyze(sys.argv[1])
    else:
        main(sys.argv[1] if len(sys.argv) > 1 else "out")
