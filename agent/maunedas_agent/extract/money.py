"""Prices in MXN to cents (07 §8.3, rule 1): never floats."""

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

_NUM = re.compile(r"(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.(\d{1,2}))?")


def parse_mxn(text: str | None) -> int | None:
    """'$1,299.00' → 129900 · 'MXN 45' → 4500 · '$28.5' → 2850; None without a number.

    Takes the text of the price element, not a phrase with quantities ("2 x $28.50" would give 200).
    """
    if not text:
        return None
    t = text.replace("\xa0", " ").replace("MXN", "").replace("$", "")
    m = _NUM.search(t)
    if not m:
        return None
    whole = int(re.sub(r"[,\s]", "", m.group(1)))
    frac = (m.group(2) or "0").ljust(2, "0")
    return whole * 100 + int(frac)


def decimal_to_cents(value: str | float | int) -> int | None:
    """JSON-LD prices ('1299.00', 1299, 322.24) to cents, half up; None if it is not a number."""
    if isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    if not d.is_finite() or d < 0:
        return None
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
