from pathlib import Path

from maunedas_agent.fetch.gate import DomainGate
from maunedas_agent.store import Store


def test_a_domain_takes_one_request_per_spacing(store: Store) -> None:
    gate = DomainGate(store)
    assert gate.try_acquire("amazon_mx", 45, 1_000_000) is True
    # Within the spacing the second request is refused, and a refusal does not move the clock.
    assert gate.try_acquire("amazon_mx", 45, 1_000_000 + 44_999) is False
    assert gate.try_acquire("amazon_mx", 45, 1_000_000 + 45_000) is True
    assert gate.try_acquire("amazon_mx", 45, 1_000_000 + 89_999) is False
    # Other domains are independent.
    assert gate.try_acquire("sams_mx", 30, 1_000_001) is True
    assert gate.try_acquire("costco_mx", 30, 1_000_001) is True
    assert gate.try_acquire("sams_mx", 0.5, 1_000_001 + 500) is True


def test_the_spacing_survives_a_restart(tmp_path: Path) -> None:
    first = Store(tmp_path / "agent.sqlite")
    assert DomainGate(first).try_acquire("amazon_mx", 45, 1_000_000) is True
    first.close()
    again = Store(tmp_path / "agent.sqlite")
    assert DomainGate(again).try_acquire("amazon_mx", 45, 1_010_000) is False
    again.close()
