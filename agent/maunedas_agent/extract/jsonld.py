"""schema.org Product and its Offer from JSON-LD (07 §8, §14)."""

import json
from dataclasses import dataclass
from typing import Any

from selectolax.lexbor import LexborHTMLParser

from maunedas_agent.extract.money import decimal_to_cents, parse_mxn

IN_STOCK = frozenset({"instock", "limitedavailability", "instoreonly", "onlineonly", "presale", "preorder"})
OUT_OF_STOCK = frozenset({"outofstock", "soldout", "discontinued"})


@dataclass(frozen=True)
class JsonLdProduct:
    name: str | None
    sku: str | None
    price_cents: int | None
    currency: str | None
    in_stock: bool | None
    seller: str | None


def blocks(tree: LexborHTMLParser) -> list[Any]:
    """Every JSON-LD block of the page that parses; broken ones are skipped."""
    out = []
    for node in tree.css('script[type="application/ld+json"]'):
        try:
            out.append(json.loads(node.text(strip=False)))
        except ValueError:
            continue
    return out


def _types(node: dict[str, Any]) -> set[str]:
    t = node.get("@type")
    values = t if isinstance(t, list) else [t]
    # Costco writes "product" in lowercase (spike B).
    return {v.lower() for v in values if isinstance(v, str)}


def _walk(value: Any) -> Any:
    """Every object in a block: lists and @graph included."""
    if isinstance(value, list):
        for item in value:
            yield from _walk(item)
    elif isinstance(value, dict):
        yield value
        if "@graph" in value:
            yield from _walk(value["@graph"])


def _availability(value: Any) -> bool | None:
    if not isinstance(value, str):
        return None
    key = value.rstrip("/").rsplit("/", 1)[-1].lower()
    if key in IN_STOCK:
        return True
    if key in OUT_OF_STOCK:
        return False
    return None


def _price(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return decimal_to_cents(value)
    if isinstance(value, str):
        cents = decimal_to_cents(value)
        return cents if cents is not None else parse_mxn(value)
    return None


def _offer(offers: Any) -> dict[str, Any] | None:
    """The first offer in pesos with a price; else the first offer at all (it may say out of stock)."""
    candidates = [o for o in (offers if isinstance(offers, list) else [offers]) if isinstance(o, dict)]
    for o in candidates:
        currency = o.get("priceCurrency")
        has_price = _price(o.get("price", o.get("lowPrice"))) is not None
        if has_price and currency in (None, "MXN"):
            return o
    return candidates[0] if candidates else None


def _seller(offer: dict[str, Any]) -> str | None:
    seller = offer.get("seller")
    if isinstance(seller, dict):
        seller = seller.get("name")
    return seller if isinstance(seller, str) and seller else None


def product(tree: LexborHTMLParser) -> JsonLdProduct | None:
    """The page's Product; None if it has none."""
    for block in blocks(tree):
        for node in _walk(block):
            if "product" not in _types(node):
                continue
            offer = _offer(node.get("offers")) or {}
            # AggregateOffer: lowPrice when there is no price.
            price = _price(offer.get("price", offer.get("lowPrice")))
            sku = node.get("sku")
            return JsonLdProduct(
                name=node.get("name") if isinstance(node.get("name"), str) else None,
                sku=str(sku) if isinstance(sku, (str, int)) else None,
                price_cents=price,
                currency=offer.get("priceCurrency") if isinstance(offer.get("priceCurrency"), str) else None,
                in_stock=_availability(offer.get("availability")),
                seller=_seller(offer),
            )
    return None
