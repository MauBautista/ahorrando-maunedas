"""Turns raw pages saved by scrape_probe.py into small, public-safe test fixtures.

Keeps what an adapter parses and nothing else:
- JSON-LD scripts;
- the product subtree of embedded state (Sam's `__NEXT_DATA__` → `props.pageProps.initialData.data.product`);
- the DOM sections of the page's own product (carousels and recommendations are dropped);
- block pages as markup only (no scripts: they carry per-visitor ids).
Tracking scripts, styles, inline SVG, hidden form fields and session/CSRF-like values are removed.

Usage: uv run --no-project --with selectolax==1.0.1 python spikes/sanitize_fixture.py OUT_DIR FIXTURES_DIR
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from selectolax.lexbor import LexborHTMLParser as HTMLParser

# (raw page in OUT_DIR, fixture in FIXTURES_DIR)
FIXTURES = [
    ("amazon_mx/papel_petalo_18.http.html", "amazon_mx/ok.html"),
    ("amazon_mx/ariel_downy_3l.http.html", "amazon_mx/sin_stock.html"),
    ("walmart_mx/leche_lala_1_5l.http.html", "walmart_mx/bloqueo.html"),
    ("sams_mx/leche_lala_12.http.html", "sams_mx/ok.html"),
    ("sams_mx/papel_petalo_6_250m.http.html", "sams_mx/sin_stock.html"),
    ("costco_mx/papel_kirkland_30.http.html", "costco_mx/ok.html"),
    ("costco_mx/leche_santa_clara_6.http.html", "costco_mx/ok_con_carrusel.html"),
]

# DOM sections kept per store (the page's own product only).
SECTIONS = {
    "amazon_mx": [
        "#glow-ingress-block",
        "#productTitle",
        "#corePriceDisplay_desktop_feature_div",
        "#corePrice_feature_div",
        "#availability",
        "#outOfStock",
        "#merchantInfoFeature_feature_div",
    ],
    "sams_mx": ["h1"],
    "costco_mx": ["sip-product-details"],
    "walmart_mx": ["body"],
}

TOKEN_PATTERNS = [
    (
        re.compile(
            r'("(?:csrf|csrfToken|sessionId|session-id|session_id|ubid|deviceId|visitorId|cid|token|'
            r'authToken|accessToken|xsrf|traceparent|_px\w*|bm_\w*|ak_bmsc|abck)"\s*:\s*)"[^"]*"',
            re.I,
        ),
        r'\1"REDACTED"',
    ),
    (re.compile(r"((?:session-id|session-token|ubid-acbmx|csm-hit)=)[^;\"'&\s]+", re.I), r"\1REDACTED"),
]
STRIP_IN_SECTIONS = (
    "script",
    "style",
    "svg",
    "noscript",
    "iframe",
    "template",
    "img",
    'input[type="hidden"]',
)


def _sams_product_state(tree: HTMLParser) -> str | None:
    node = tree.css_first('script[id="__NEXT_DATA__"]')
    if not node:
        return None
    data = json.loads(node.text(strip=False))
    product = data["props"]["pageProps"]["initialData"]["data"]["product"]
    pruned = {"props": {"pageProps": {"initialData": {"data": {"product": product}}}}}
    return json.dumps(pruned, ensure_ascii=False, separators=(",", ":"))


def sanitize(adapter: str, html: str) -> str:
    tree = HTMLParser(html)
    title_node = tree.css_first("title")
    title = title_node.text(strip=True) if title_node else ""
    head = [f"<title>{title}</title>"]
    for script in tree.css('script[type="application/ld+json"]'):
        head.append(f'<script type="application/ld+json">{script.text(strip=False).strip()}</script>')
    if adapter == "sams_mx":
        state = _sams_product_state(tree)
        if state:
            head.append(f'<script id="__NEXT_DATA__" type="application/json">{state}</script>')

    body: list[str] = []
    for selector in SECTIONS[adapter]:
        node = tree.css_first(selector)
        if not node:
            continue
        for unwanted in STRIP_IN_SECTIONS:
            for child in node.css(unwanted):
                child.decompose()
        body.append(node.html or "")
    if adapter == "walmart_mx":
        body = [re.sub(r"^<body[^>]*>|</body>$", "", body[0])] if body else []

    out = (
        '<!doctype html>\n<html lang="es-MX">\n<head>\n<meta charset="utf-8">\n'
        + "\n".join(head)
        + "\n</head>\n<body>\n"
        + "\n".join(body)
        + "\n</body>\n</html>\n"
    )
    out = re.sub(r"<!--.*?-->", "", out, flags=re.S)
    out = re.sub(r'\s_ng(?:content|host)-[a-z0-9-]+=""', "", out)
    for pattern, replacement in TOKEN_PATTERNS:
        out = pattern.sub(replacement, out)
    return re.sub(r"\n\s*\n+", "\n", out)


def main(out_dir: str, fixtures_dir: str) -> None:
    for raw, fixture in FIXTURES:
        adapter = fixture.split("/")[0]
        text = (Path(out_dir) / raw).read_text(encoding="utf-8", errors="replace")
        clean = sanitize(adapter, text)
        target = Path(fixtures_dir) / fixture
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(clean, encoding="utf-8")
        print(f"{raw}: {len(text) // 1024} KB -> {fixture}: {len(clean) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
