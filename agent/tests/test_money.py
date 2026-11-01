import pytest

from maunedas_agent.extract.money import decimal_to_cents, parse_mxn


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("$1,299.00", 129900),
        ("$ 28.50", 2850),
        ("MXN 45", 4500),
        ("$28.5", 2850),
        ("1 299,00", 129900),
        ("Precio: $89.90 c/u", 8990),
        ("$0.99", 99),
        ("$\xa01,299.00", 129900),
        ("$12,345,678.90", 1234567890),
        ("", None),
        (None, None),
        ("Agotado", None),
    ],
)
def test_parse_mxn(text: str | None, cents: int | None) -> None:
    assert parse_mxn(text) == cents


@pytest.mark.parametrize(
    ("value", "cents"),
    [("1299.00", 129900), (1299, 129900), (322.24, 32224), ("529.0", 52900), ("0.995", 100), ("0.994", 99)],
)
def test_decimal_to_cents(value: str | float | int, cents: int) -> None:
    assert decimal_to_cents(value) == cents


@pytest.mark.parametrize("value", ["", "gratis", "NaN", "Infinity", "-5", True])
def test_decimal_to_cents_refuses_what_is_not_a_price(value: object) -> None:
    assert decimal_to_cents(value) is None  # type: ignore[arg-type]
