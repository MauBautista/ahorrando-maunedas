from pathlib import Path

from maunedas_agent.extract.embedded import dig, next_data, script_json
from maunedas_agent.extract.html import parse

FIXTURES = Path(__file__).parent / "fixtures" / "html"


def test_next_data_of_a_saved_page() -> None:
    data = next_data(parse((FIXTURES / "sams_mx/ok.html").read_text()))
    product = dig(data, "props.pageProps.initialData.data.product")
    assert dig(product, "priceInfo.currentPrice.price") == 322.24
    assert product["availabilityStatus"] == "IN_STOCK"


def test_missing_or_broken_state() -> None:
    assert next_data(parse("<html></html>")) is None
    assert next_data(parse('<script id="__NEXT_DATA__" type="application/json">{nope</script>')) is None
    assert script_json(parse('<script id="state">[1, 2]</script>'), "script#state") == [1, 2]


def test_dig() -> None:
    data = {"a": {"b": [{"c": 1}, {"c": None}]}}
    assert dig(data, "a.b.0.c") == 1
    assert dig(data, "a.b.1.c") is None
    assert dig(data, "a.b.2.c") is None
    assert dig(data, "a.x.c") is None
    assert dig(data, "a.b.c") is None
    assert dig(None, "a") is None
