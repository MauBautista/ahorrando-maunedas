import json
import re
from pathlib import Path

import pytest
import respx

from maunedas_agent.adapters.base import FetchContext, ScrapeResult
from maunedas_agent.adapters.common import FAILURES_KEPT, NO_PRICE, SAMPLES_KEPT
from maunedas_agent.adapters.registry import ADAPTERS
from maunedas_agent.config import Settings
from maunedas_agent.fetch.http import HttpFetcher, Page
from maunedas_agent.store import Store

FIXTURES = Path(__file__).parent / "fixtures" / "html"
AMAZON = ADAPTERS["amazon_mx"]
SAMS = ADAPTERS["sams_mx"]
COSTCO = ADAPTERS["costco_mx"]


def html(name: str) -> str:
    return (FIXTURES / name).read_text()


def read(adapter, body: str, status: int = 200, url: str = "https://www.example.com/p") -> ScrapeResult:
    return adapter.read(Page(status, url, body, 1))


def test_registry_follows_spike_b() -> None:
    assert {n: (a.min_spacing_s, a.needs_browser, a.gate_key) for n, a in ADAPTERS.items()} == {
        "amazon_mx": (45, False, "amazon_mx"),
        "sams_mx": (120, False, "sams_mx"),
        "costco_mx": (30, False, "costco_mx"),
    }


# Amazon


def test_amazon_ok() -> None:
    r = read(AMAZON, html("amazon_mx/ok.html"))
    assert r == ScrapeResult(
        "ok", 11869, None, True, None, {"method": "http_selectors", "seller": "Amazon México"}, None
    )


def test_amazon_out_of_stock_has_no_price() -> None:
    r = read(AMAZON, html("amazon_mx/sin_stock.html"))
    assert (r.status, r.price_cents, r.in_stock, r.list_price_cents) == ("ok", None, False, None)


def test_amazon_out_of_stock_drops_a_leftover_price() -> None:
    # Only the #outOfStock box, no availability text: still out of stock, and its old price is not the price.
    page = html("amazon_mx/ok.html").replace(
        '<div id="availability"', '<div id="outOfStock">No disponible.</div><div id="old-availability"'
    )
    r = read(AMAZON, page)
    assert (r.status, r.price_cents, r.in_stock) == ("ok", None, False)


def test_amazon_list_price_is_the_struck_one_not_the_price_per_unit() -> None:
    page = html("amazon_mx/ok.html").replace(
        '<span class="apex-basisprice-feature">',
        '<span class="apex-basisprice-feature"><span class="a-price a-text-price apex-basisprice-value" '
        'data-a-strike="true"><span class="a-offscreen">$149.00</span></span>',
    )
    assert read(AMAZON, page).list_price_cents == 14900
    # A "list price" below the price to pay is not one.
    cheaper = page.replace("$149.00", "$99.00")
    assert read(AMAZON, cheaper).list_price_cents is None


def test_amazon_price_fallbacks() -> None:
    page = html("amazon_mx/ok.html")
    # Without the accessibility label: the visible digits.
    no_label = re.sub(r'<span id="apex-pricetopay-accessibility-label"[^>]*>[^<]*</span>', "", page)
    assert read(AMAZON, no_label).price_cents == 11869
    # The offscreen copy wins when it has text.
    filled = page.replace('<span class="a-offscreen"> </span>', '<span class="a-offscreen">$117.50</span>', 1)
    assert read(AMAZON, filled).price_cents == 11750
    # Older layout.
    older = (
        '<div id="corePrice_feature_div">'
        '<span class="a-price" data-a-strike="true"><span class="a-offscreen">$300.00</span></span>'
        '<span class="a-price apex-priceperunit-value"><span class="a-offscreen">$1.00</span></span>'
        '<span class="a-price"><span class="a-offscreen">$250.00</span></span></div>'
    )
    assert read(AMAZON, older).price_cents == 25000
    assert read(AMAZON, older).list_price_cents == 30000


def test_amazon_promotion_from_a_real_page() -> None:
    r = read(AMAZON, html("amazon_mx/ok_con_promocion.html"))
    assert (r.status, r.price_cents, r.in_stock) == ("ok", 11869, True)
    assert r.promo_text == (
        "Suma y Ahorra 5% en 5+ artículos elegibles productos elegibles "
        "Suma y Ahorra 5% extra en 10+ artículos elegibles productos elegibles"
    )


def test_amazon_texts_leave_out_inline_styles_and_scripts() -> None:
    page = html("amazon_mx/ok.html").replace(
        "</body>",
        '<div id="promoPriceBlockMessage_feature_div">  Ahorra   10% <style>.x{color:red}</style> con '
        "<script>var a=1;</script>  Suscríbete </div></body>",
    )
    assert read(AMAZON, page).promo_text == "Ahorra 10% con Suscríbete"
    page = html("amazon_mx/sin_stock.html").replace(
        '<div id="availability" class="a-section a-spacing-base a-spacing-top-micro }">',
        '<div id="availability" class="a-section"><script>var agotado = "Disponible";</script>',
    )
    assert read(AMAZON, page).in_stock is False


def test_amazon_blocks_missing_pages_and_changed_pages() -> None:
    captcha = (
        '<html><head><title dir="ltr">Amazon.com</title></head><body><form method="get" '
        'action="/errors/validateCaptcha"><input type="text" id="captchacharacters"></form></body></html>'
    )
    assert read(AMAZON, captcha).status == "blocked"
    assert read(AMAZON, "<p>Escribe los caracteres (captcha)</p>", 503).status == "blocked"
    assert read(AMAZON, "<title>Página no encontrada</title>", 404).status == "not_found"
    assert (read(AMAZON, "<p>error</p>", 500).status, read(AMAZON, "<p>error</p>", 500).error) == (
        "error",
        "HTTP 500",
    )
    changed = read(AMAZON, "<html><title>Producto</title><div id='productTitle'>x</div></html>")
    assert (changed.status, changed.error) == ("error", NO_PRICE)


# Sam's


def test_sams_ok_from_the_page_product() -> None:
    r = read(SAMS, html("sams_mx/ok.html"))
    assert r == ScrapeResult(
        "ok",
        32224,
        None,
        True,
        "11 x 10",
        {"method": "http_next_data", "club": "0000009996", "postal_code": "11220"},
        None,
    )


def test_sams_out_of_stock() -> None:
    r = read(SAMS, html("sams_mx/sin_stock.html"))
    assert (r.status, r.price_cents, r.in_stock) == ("ok", None, False)


def _with_product(page: str, change) -> str:
    m = re.search(r'(<script id="__NEXT_DATA__" type="application/json">)(.*?)(</script>)', page, re.S)
    data = json.loads(m.group(2))
    change(data["props"]["pageProps"]["initialData"]["data"]["product"])
    return page[: m.start(2)] + json.dumps(data) + page[m.end(2) :]


def test_sams_list_price_and_promotions() -> None:
    def was(price):
        def change(p):
            p["priceInfo"]["wasPrice"] = {"price": price, "priceString": f"${price}"}
            p["badges"]["flags"].append({"text": "Más vendido", "key": "BEST_SELLER"})
            p["badges"]["flags"].append({"text": "-15%", "key": "ROLLBACK"})

        return change

    page = _with_product(html("sams_mx/ok.html"), was(350))
    r = read(SAMS, page)
    assert (r.list_price_cents, r.promo_text) == (35000, "11 x 10 · -15%")
    assert read(SAMS, _with_product(html("sams_mx/ok.html"), was(300))).list_price_cents is None

    def list_price(p):
        p["priceInfo"]["listPrice"] = {"price": "399.00"}

    assert read(SAMS, _with_product(html("sams_mx/ok.html"), list_price)).list_price_cents == 39900


def test_sams_falls_back_to_json_ld() -> None:
    page = re.sub(r'<script id="__NEXT_DATA__".*?</script>', "", html("sams_mx/ok.html"), flags=re.S)
    r = read(SAMS, page)
    assert (r.price_cents, r.in_stock, r.extra) == (32224, True, {"method": "http_jsonld"})

    def empty(p):
        p["priceInfo"]["currentPrice"] = None
        p["availabilityStatus"] = "UNKNOWN"

    assert read(SAMS, _with_product(html("sams_mx/ok.html"), empty)).extra == {"method": "http_jsonld"}


def test_sams_block_like_walmart() -> None:
    assert (
        read(SAMS, html("walmart_mx/bloqueo.html"), url="https://www.sams.com.mx/blocked?url=x").status
        == "blocked"
    )


# Costco


@pytest.mark.parametrize(
    ("fixture", "cents"), [("costco_mx/ok.html", 52900), ("costco_mx/ok_con_carrusel.html", 18900)]
)
def test_costco_ok(fixture: str, cents: int) -> None:
    assert read(COSTCO, html(fixture)) == ScrapeResult(
        "ok", cents, None, True, None, {"method": "http_jsonld"}, None
    )


def test_costco_dom_fallback_only_inside_the_product() -> None:
    no_ld = re.sub(
        r'<script type="application/ld\+json">.*?</script>', "", html("costco_mx/ok.html"), flags=re.S
    )
    assert read(COSTCO, no_ld) == ScrapeResult(
        "ok", 52900, None, True, None, {"method": "http_selectors"}, None
    )
    # The milk page has no product price in its DOM: the carousel's $259 must not be taken.
    carousel = re.sub(
        r'<script type="application/ld\+json">.*?</script>',
        "",
        html("costco_mx/ok_con_carrusel.html"),
        flags=re.S,
    )
    assert "259" in carousel
    assert (read(COSTCO, carousel).status, read(COSTCO, carousel).error) == ("error", NO_PRICE)


def test_costco_dom_ignores_a_carousel_before_the_product() -> None:
    page = (
        '<div class="carousel"><span class="product-price-amount">$259.00</span></div>'
        '<sip-product-details><span class="product-price-amount">$189.00</span></sip-product-details>'
    )
    assert read(COSTCO, page).price_cents == 18900


def test_costco_out_of_stock() -> None:
    page = re.sub(r'"price":\s*"529.0"', '"price": ""', html("costco_mx/ok.html"))
    page = page.replace("http://schema.org/InStock", "http://schema.org/OutOfStock")
    r = read(COSTCO, page)
    assert (r.status, r.price_cents, r.in_stock) == ("ok", None, False)


# Fetch path


def _list_price_page() -> str:
    return html("amazon_mx/ok.html").replace(
        '<span class="apex-basisprice-feature">',
        '<span class="apex-basisprice-feature"><span class="a-price a-text-price apex-basisprice-value" '
        'data-a-strike="true"><span class="a-offscreen">$149.00</span></span>',
    )


@respx.mock
async def test_fetch_keeps_the_first_pages_with_a_list_price(settings: Settings, store: Store) -> None:
    http = HttpFetcher(settings, store)
    ctx = FetchContext(settings=settings, http=http)
    folder = settings.data_dir / "muestras" / "amazon_mx"
    respx.get("https://www.amazon.com.mx/dp/B0PLAIN").respond(200, html=html("amazon_mx/ok.html"))
    await AMAZON.fetch("https://www.amazon.com.mx/dp/B0PLAIN", ctx)
    assert not folder.exists()
    for i in range(7):
        respx.get(f"https://www.amazon.com.mx/dp/B0LIST{i}").respond(200, html=_list_price_page())
    # The same page twice is one sample.
    r = await AMAZON.fetch("https://www.amazon.com.mx/dp/B0LIST0", ctx)
    assert r.list_price_cents == 14900
    await AMAZON.fetch("https://www.amazon.com.mx/dp/B0LIST0", ctx)
    assert len(list(folder.glob("*.html"))) == 1
    assert "$149.00" in next(folder.glob("*.html")).read_text()
    for i in range(1, 7):
        await AMAZON.fetch(f"https://www.amazon.com.mx/dp/B0LIST{i}", ctx)
    assert len(list(folder.glob("*.html"))) == SAMPLES_KEPT
    await http.aclose()


async def test_a_list_price_found_by_the_browser_is_kept_too(settings: Settings, store: Store) -> None:
    class Pages:
        def __init__(self, body: str) -> None:
            self.body = body

        async def get(self, url: str, wait_for: str | None = None) -> Page:
            return Page(200, url, self.body, 1)

    async def wait_turn(_adapter) -> None:
        pass

    url = "https://www.amazon.com.mx/dp/B0BROWSE"
    ctx = FetchContext(
        settings, http=Pages("<html></html>"), browser=Pages(_list_price_page()), wait_turn=wait_turn
    )  # type: ignore[arg-type]
    r = await AMAZON.fetch(url, ctx)
    assert (r.extra["method"], r.list_price_cents) == ("browser_selectors", 14900)
    assert len(list((settings.data_dir / "muestras" / "amazon_mx").glob("*.html"))) == 1


@respx.mock
async def test_fetch_keeps_unreadable_pages_for_fixtures(settings: Settings, store: Store) -> None:
    url = "https://www.costco.com.mx/p/1"
    respx.get(url).respond(200, html="<html><title>Rediseño</title></html>")
    http = HttpFetcher(settings, store)
    ctx = FetchContext(settings=settings, http=http)
    for _ in range(FAILURES_KEPT + 3):
        r = await COSTCO.fetch(url, ctx)
    assert (r.status, r.error, r.extra) == ("error", NO_PRICE, {"method": "http", "http_status": 200})
    saved = sorted((settings.data_dir / "fallos" / "costco_mx").glob("*.html"))
    assert len(saved) == FAILURES_KEPT
    assert "Rediseño" in saved[0].read_text()

    respx.get("https://www.costco.com.mx/p/2").respond(200, html=html("costco_mx/ok.html"))
    ok = await COSTCO.fetch("https://www.costco.com.mx/p/2", ctx)
    assert (ok.price_cents, ok.extra["http_status"]) == (52900, 200)
    await http.aclose()
