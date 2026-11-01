"""Store links to adapter, canonical URL and id, as in packages/shared/src/tracking/urls.ts (07 §9).

Both pass fixtures/enlaces.json. The Worker resolves short links (amzn.to, a.co) before they reach the agent.
"""

import re
from typing import NamedTuple
from urllib.parse import unquote, urlsplit

ASIN = re.compile(r"/(?:dp|gp/product|gp/aw/d)/([A-Z0-9]{10})(?:[/?#]|$)", re.IGNORECASE)
SAMS = re.compile(r"^/ip/([^/]+)/([0-9A-Za-z]+)/?$")
COSTCO = re.compile(r"^(.*/p/([0-9A-Za-z]+))/?$")


class CanonicalListing(NamedTuple):
    adapter: str
    canonical_url: str
    external_id: str | None


def canonical_listing(raw: str) -> CanonicalListing | None:
    """None when no adapter tracks the link (Walmart, decision T34) or it is not a product page."""
    try:
        url = urlsplit(raw.strip())
        host = (url.hostname or "").removeprefix("www.")
    except ValueError:
        return None
    if url.scheme.lower() not in ("http", "https"):
        return None
    try:
        path = unquote(url.path, errors="strict")
    except UnicodeDecodeError:
        # A malformed escape is left as it came.
        path = url.path
    if host == "amazon.com.mx":
        m = ASIN.search(path)
        return (
            CanonicalListing("amazon_mx", f"https://www.amazon.com.mx/dp/{m[1].upper()}", m[1].upper())
            if m
            else None
        )
    if host == "sams.com.mx":
        m = SAMS.match(path)
        return CanonicalListing("sams_mx", f"https://www.sams.com.mx/ip/{m[1]}/{m[2]}", m[2]) if m else None
    if host == "costco.com.mx":
        m = COSTCO.match(path)
        return CanonicalListing("costco_mx", f"https://www.costco.com.mx{m[1]}", m[2]) if m else None
    return None
