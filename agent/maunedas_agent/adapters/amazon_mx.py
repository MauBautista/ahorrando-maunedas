"""Amazon México (07 §9, spike B): HTTP and the price block's selectors; no product JSON-LD."""

import re

from selectolax.lexbor import LexborHTMLParser, LexborNode

from maunedas_agent.adapters.base import ScrapeResult
from maunedas_agent.adapters.common import BaseAdapter, clean
from maunedas_agent.extract.money import parse_mxn

PRICE_BLOCKS = ("#corePriceDisplay_desktop_feature_div", "#corePrice_feature_div", "#apex_desktop")
OUT_OF_STOCK_TEXTS = ("no disponible", "agotado")


def _first_text(root: LexborNode, *selectors: str) -> str | None:
    for selector in selectors:
        for node in root.css(selector):
            text = clean(node.text(separator=" "))
            if text:
                return text
    return None


def _price_to_pay(block: LexborNode) -> int | None:
    # The offscreen copy is sometimes empty; then the accessibility label, then the visible digits.
    text = _first_text(block, ".apex-pricetopay-value .a-offscreen", "#apex-pricetopay-accessibility-label")
    if text:
        return parse_mxn(text)
    whole = re.sub(r"\D", "", _first_text(block, ".apex-pricetopay-value .a-price-whole") or "")
    if whole:
        fraction = (
            re.sub(r"\D", "", _first_text(block, ".apex-pricetopay-value .a-price-fraction") or "") or "00"
        )
        return parse_mxn(f"{whole}.{fraction}")
    # Older layout: the first price that is neither struck through nor per unit.
    for node in block.css(".a-price"):
        classes = node.attributes.get("class") or ""
        if node.attributes.get("data-a-strike") == "true" or "apex-priceperunit-value" in classes:
            continue
        cents = parse_mxn(_first_text(node, ".a-offscreen"))
        if cents is not None:
            return cents
    return None


def _list_price(block: LexborNode) -> int | None:
    # The first .a-text-price is the price per unit, not the list price (spike B).
    text = _first_text(
        block,
        ".apex-basisprice-value .a-offscreen",
        ".basisPrice .a-offscreen",
        '.a-price[data-a-strike="true"] .a-offscreen',
    )
    return parse_mxn(text)


class AmazonMx(BaseAdapter):
    name = "amazon_mx"
    domains = ("amazon.com.mx",)
    min_spacing_s = 45
    price_selector = "#corePriceDisplay_desktop_feature_div, #availability"

    def extract(self, tree: LexborHTMLParser) -> ScrapeResult | None:
        # No JSON-LD to keep here; inline styles and scripts leak into texts (spike B: #availability).
        for node in tree.css("style, script, noscript"):
            node.decompose()
        node = tree.css_first("#availability")
        availability = clean(node.text(separator=" ")) if node is not None else None
        out_of_stock = tree.css_first("#outOfStock") is not None or any(
            t in (availability or "").lower() for t in OUT_OF_STOCK_TEXTS
        )
        block = next((b for b in (tree.css_first(s) for s in PRICE_BLOCKS) if b is not None), None)
        price = _price_to_pay(block) if block is not None else None
        if price is None and not out_of_stock:
            return None
        listed = _list_price(block) if block is not None and price is not None else None
        seller = _first_text(
            tree.root, "#merchantInfoFeature_feature_div .offer-display-feature-text-message"
        )
        extra: dict[str, object] = {"method": "http_selectors"}
        if seller:
            extra["seller"] = seller
        return ScrapeResult(
            "ok",
            price_cents=None if out_of_stock else price,
            list_price_cents=listed if listed is not None and price is not None and listed > price else None,
            in_stock=not out_of_stock,
            promo_text=_first_text(tree.root, "#promoPriceBlockMessage_feature_div"),
            extra=extra,
        )
