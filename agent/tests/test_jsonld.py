import json
from pathlib import Path

import pytest

from maunedas_agent.extract.html import parse
from maunedas_agent.extract.jsonld import JsonLdProduct, product

FIXTURES = Path(__file__).parent / "fixtures" / "html"


def page(*blocks: object, raw: str = "") -> str:
    scripts = "".join(f'<script type="application/ld+json">{json.dumps(b)}</script>' for b in blocks)
    return f"<html><head>{raw}{scripts}</head><body></body></html>"


def of(html: str) -> JsonLdProduct | None:
    return product(parse(html))


def test_offer_as_an_object() -> None:
    p = of(
        page(
            {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Leche",
                "sku": 123,
                "offers": {
                    "@type": "Offer",
                    "price": "28.50",
                    "priceCurrency": "MXN",
                    "availability": "https://schema.org/InStock",
                    "seller": {"@type": "Organization", "name": "Tienda"},
                },
            }
        )
    )
    assert p == JsonLdProduct("Leche", "123", 2850, "MXN", True, "Tienda")


def test_offers_as_a_list_take_the_first_in_pesos_with_a_price() -> None:
    p = of(
        page(
            {
                "@type": ["Product", "Thing"],
                "offers": [
                    {"price": None, "priceCurrency": "MXN", "availability": "OutOfStock"},
                    {"price": 10, "priceCurrency": "USD"},
                    {
                        "price": 322.24,
                        "priceCurrency": "MXN",
                        "availability": "http://schema.org/OutOfStock/",
                    },
                ],
            }
        )
    )
    assert (p.price_cents, p.currency, p.in_stock) == (32224, "MXN", False)


def test_aggregate_offer_and_graph() -> None:
    p = of(
        page(
            {
                "@graph": [
                    {"@type": "WebPage"},
                    {
                        "@type": "Product",
                        "offers": {"@type": "AggregateOffer", "lowPrice": "1,299.00", "highPrice": 2000},
                    },
                ]
            }
        )
    )
    assert p.price_cents == 129900


def test_without_offers_or_product() -> None:
    assert of(page({"@type": "Product", "name": "x"})) == JsonLdProduct("x", None, None, None, None, None)
    assert of(page({"@type": "BreadcrumbList"}, [{"@type": "WebSite"}])) is None
    # A broken block does not hide a good one.
    assert of(
        page(
            {"@type": "Product", "offers": {"price": 5}},
            raw='<script type="application/ld+json">{bad</script>',
        )
    )
    assert of("<html></html>") is None


@pytest.mark.parametrize(
    ("availability", "in_stock"),
    [
        ("https://schema.org/InStock", True),
        ("http://schema.org/LimitedAvailability", True),
        ("OutOfStock", False),
        ("https://schema.org/SoldOut", False),
        ("https://schema.org/BackOrder", None),
        (None, None),
    ],
)
def test_availability(availability: str | None, in_stock: bool | None) -> None:
    assert (
        of(page({"@type": "Product", "offers": {"price": 1, "availability": availability}})).in_stock
        is in_stock
    )


@pytest.mark.parametrize(
    ("fixture", "expected"),
    [
        ("sams_mx/ok.html", ("980034851", 32224, True)),
        ("sams_mx/sin_stock.html", ("000188399", None, False)),
        ("costco_mx/ok.html", ("6262016", 52900, True)),
        # Costco's "product" in lowercase; the carousel's prices are not in JSON-LD.
        ("costco_mx/ok_con_carrusel.html", ("668241", 18900, True)),
    ],
)
def test_saved_store_pages(fixture: str, expected: tuple) -> None:
    p = of((FIXTURES / fixture).read_text())
    assert (p.sku, p.price_cents, p.in_stock) == expected
    assert p.currency == "MXN"


def test_amazon_has_no_product_json_ld() -> None:
    assert of((FIXTURES / "amazon_mx/ok.html").read_text()) is None
