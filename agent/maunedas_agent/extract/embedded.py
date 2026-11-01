"""State embedded in the page (07 §8): Next.js `__NEXT_DATA__` and the like."""

import json
from typing import Any

from selectolax.lexbor import LexborHTMLParser


def script_json(tree: LexborHTMLParser, selector: str) -> Any | None:
    """The JSON inside the first script matching `selector`; None if missing or broken."""
    node = tree.css_first(selector)
    if node is None:
        return None
    try:
        return json.loads(node.text(strip=False))
    except ValueError:
        return None


def next_data(tree: LexborHTMLParser) -> Any | None:
    return script_json(tree, "script#__NEXT_DATA__")


def dig(value: Any, path: str) -> Any | None:
    """`dig(data, "props.pageProps.initialData")`; list items by index ("items.0.price")."""
    for key in path.split("."):
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        else:
            return None
        if value is None:
            return None
    return value
