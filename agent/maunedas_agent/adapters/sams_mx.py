"""Sam's Club México (07 §9, spike B): HTTP; the page's product in __NEXT_DATA__, JSON-LD as fallback."""

import re
from typing import Any

from selectolax.lexbor import LexborHTMLParser

from maunedas_agent.adapters.base import ScrapeResult
from maunedas_agent.adapters.common import BaseAdapter, clean
from maunedas_agent.extract.embedded import dig, next_data
from maunedas_agent.extract.jsonld import product as jsonld_product
from maunedas_agent.extract.money import decimal_to_cents

# A generic walk of __NEXT_DATA__ finds the carousels first: only the page's own product (spike B).
PRODUCT_PATH = "props.pageProps.initialData.data.product"
AVAILABILITY = {"IN_STOCK": True, "OUT_OF_STOCK": False}


def _cents(value: Any) -> int | None:
    return (
        decimal_to_cents(value)
        if isinstance(value, (int, float, str)) and not isinstance(value, bool)
        else None
    )


def _promo(product: dict[str, Any]) -> str | None:
    """Price badges ("11 x 10", "2x1", "-15%"); others ("MSI", "Más vendido") are not promotions."""
    texts = [
        clean(flag.get("text"))
        for flag in dig(product, "badges.flags") or []
        if isinstance(flag, dict) and isinstance(flag.get("text"), str) and re.search(r"\d", flag["text"])
    ]
    texts = [t for t in texts if t]
    return " · ".join(texts) or None


class SamsMx(BaseAdapter):
    name = "sams_mx"
    domains = ("sams.com.mx",)
    # Sam's blocked the home IP after a burst at 30 s (2026-11-01, T94).
    min_spacing_s = 120
    price_selector = "script#__NEXT_DATA__"

    def extract(self, tree: LexborHTMLParser) -> ScrapeResult | None:
        product = dig(next_data(tree), PRODUCT_PATH)
        if isinstance(product, dict):
            result = self._from_product(product)
            if result is not None:
                return result
        ld = jsonld_product(tree)
        if ld is None or (ld.price_cents is None and ld.in_stock is None):
            return None
        return ScrapeResult(
            "ok",
            price_cents=ld.price_cents,
            in_stock=ld.in_stock if ld.in_stock is not None else True,
            extra={"method": "http_jsonld"},
        )

    def _from_product(self, product: dict[str, Any]) -> ScrapeResult | None:
        price = _cents(dig(product, "priceInfo.currentPrice.price"))
        in_stock = AVAILABILITY.get(str(product.get("availabilityStatus")))
        if price is None and in_stock is None:
            return None
        was = _cents(dig(product, "priceInfo.wasPrice.price")) or _cents(
            dig(product, "priceInfo.listPrice.price")
        )
        extra: dict[str, Any] = {"method": "http_next_data"}
        # Without a session Sam's uses a default club (CDMX in spike B): kept to tell clubs' prices apart.
        club = dig(product, "location.storeIds.0")
        postal_code = dig(product, "location.postalCode")
        if club:
            extra["club"] = str(club)
        if postal_code:
            extra["postal_code"] = str(postal_code)
        return ScrapeResult(
            "ok",
            price_cents=price,
            list_price_cents=was if was is not None and price is not None and was > price else None,
            in_stock=in_stock if in_stock is not None else price is not None,
            promo_text=_promo(product),
            extra=extra,
        )
