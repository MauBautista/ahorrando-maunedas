from pathlib import Path

import pytest

from maunedas_agent.extract.blocks import is_blocked

FIXTURES = Path(__file__).parent / "fixtures" / "html"


def test_walmart_perimeterx_page_is_a_block() -> None:
    html = (FIXTURES / "walmart_mx/bloqueo.html").read_text()
    assert is_blocked(200, html, "https://www.walmart.com.mx/blocked?url=x") is True
    assert is_blocked(200, html) is True


@pytest.mark.parametrize(
    "fixture", ["amazon_mx/ok.html", "amazon_mx/sin_stock.html", "sams_mx/ok.html", "costco_mx/ok.html"]
)
def test_product_pages_are_not_blocks(fixture: str) -> None:
    assert is_blocked(200, (FIXTURES / fixture).read_text(), "https://www.example.com/p/1") is False


def test_weak_markers_need_a_block_status() -> None:
    html = "<html><title>Producto</title><p>Resuelve el CAPTCHA para continuar</p></html>"
    assert is_blocked(200, html) is False
    for status in (403, 429, 503):
        assert is_blocked(status, html) is True
    assert is_blocked(503, "<html><title>Mantenimiento</title></html>") is False
    assert is_blocked(403, "<html><h1>Access Denied</h1></html>") is True


def test_strong_markers_titles_and_paths() -> None:
    assert is_blocked(200, '<form action="/errors/validateCaptcha"></form>') is True
    assert is_blocked(200, "<html><title>Robot Check</title></html>") is True
    assert is_blocked(200, "<html><title>Just a moment...</title></html>") is True
    assert is_blocked(200, "<html></html>", "https://www.sams.com.mx/blocked/") is True
    assert is_blocked(200, "<html></html>", "https://www.sams.com.mx/blocked-items") is False
    # An adapter's own marker.
    assert is_blocked(200, "<div class='bot-wall'></div>", extra=("bot-wall",)) is True
    assert is_blocked(200, "<div class='bot-wall'></div>") is False
