"""Was the page a block or a captcha? (07 §8.4, rule 10: detected and reported, never evaded.)"""

from collections.abc import Iterable
from urllib.parse import urlsplit

from selectolax.lexbor import LexborHTMLParser

from maunedas_agent.extract.html import parse, title

BLOCK_STATUSES = frozenset({403, 429, 503})
# Only a block when the status says so: a product page may mention "captcha" in passing.
MARKERS = ("captcha", "validatecaptcha", "px-captcha", "access denied")
# Challenge pages that can come with 200: these alone are a block.
STRONG_MARKERS = ("validatecaptcha", "px-captcha", "captcha-delivery.com", "/cdn-cgi/challenge-platform")
VERIFY_TITLES = (
    "verifica tu identidad",
    "robot check",
    "access denied",
    "attention required",
    "just a moment",
    "are you a robot",
    "eres un robot",
)
BLOCK_PATHS = ("/blocked",)


def is_blocked(
    status: int,
    html: str,
    final_url: str = "",
    tree: LexborHTMLParser | None = None,
    extra: Iterable[str] = (),
) -> bool:
    """`extra`: markers of one adapter, lowercase, counted like the strong ones."""
    body = html.lower()
    if any(m in body for m in (*STRONG_MARKERS, *extra)):
        return True
    if status in BLOCK_STATUSES and any(m in body for m in MARKERS):
        return True
    if urlsplit(final_url).path.rstrip("/") in BLOCK_PATHS:
        return True
    page_title = title(tree if tree is not None else parse(html)).lower()
    return any(t in page_title for t in VERIFY_TITLES)
