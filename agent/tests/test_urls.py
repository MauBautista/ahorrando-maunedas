import json
from pathlib import Path

import pytest

from maunedas_agent.adapters.registry import ADAPTERS
from maunedas_agent.urls import canonical_listing

CASES = json.loads((Path(__file__).parents[2] / "fixtures" / "enlaces.json").read_text())["canonica"]


@pytest.mark.parametrize("case", CASES, ids=[c["entrada"] for c in CASES])
def test_shared_link_vectors(case: dict) -> None:
    got = canonical_listing(case["entrada"])
    assert (got._asdict() if got else None) == case["esperado"]


def test_each_adapter_only_canonicalizes_its_own_links() -> None:
    url = "https://www.amazon.com.mx/Leche/dp/B07XJ8C8F5?ref=x"
    assert ADAPTERS["amazon_mx"].canonicalize(url).canonical_url == "https://www.amazon.com.mx/dp/B07XJ8C8F5"
    assert ADAPTERS["sams_mx"].canonicalize(url) is None
    assert canonical_listing("https://www.costco.com.mx/p/1%ZZ") is None
    assert canonical_listing("https://[broken/p/1") is None
    assert canonical_listing("https://www.sams.com.mx/ip/leche%20lala/981") == (
        "sams_mx",
        "https://www.sams.com.mx/ip/leche lala/981",
        "981",
    )
