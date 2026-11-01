"""HTML parsing with selectolax's lexbor parser (selectolax 1.0 dropped Modest; spike B)."""

from selectolax.lexbor import LexborHTMLParser


def parse(html: str) -> LexborHTMLParser:
    return LexborHTMLParser(html)


def title(tree: LexborHTMLParser) -> str:
    node = tree.css_first("title")
    return node.text(strip=True) if node is not None else ""
