"""Costco México (07 §9, spike B): HTTP and JSON-LD; the product's DOM as fallback."""

from selectolax.lexbor import LexborHTMLParser

from maunedas_agent.adapters.base import ScrapeResult
from maunedas_agent.adapters.common import BaseAdapter
from maunedas_agent.extract.jsonld import product as jsonld_product
from maunedas_agent.extract.money import parse_mxn

# Only this element is the product: the first .product-price-amount and "Agotado" are carousels (spike B).
PRODUCT_DOM = "sip-product-details"


class CostcoMx(BaseAdapter):
    name = "costco_mx"
    domains = ("costco.com.mx",)
    min_spacing_s = 30

    def extract(self, tree: LexborHTMLParser) -> ScrapeResult | None:
        ld = jsonld_product(tree)
        if ld is not None and (ld.price_cents is not None or ld.in_stock is not None):
            return ScrapeResult(
                "ok",
                price_cents=ld.price_cents,
                in_stock=ld.in_stock if ld.in_stock is not None else True,
                extra={"method": "http_jsonld"},
            )
        details = tree.css_first(PRODUCT_DOM)
        node = details.css_first(".product-price-amount") if details is not None else None
        price = parse_mxn(node.text(separator=" ")) if node is not None else None
        if price is None:
            return None
        return ScrapeResult("ok", price_cents=price, in_stock=True, extra={"method": "http_selectors"})
