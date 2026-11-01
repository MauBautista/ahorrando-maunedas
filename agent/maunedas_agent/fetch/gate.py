"""Minimum spacing between requests to one domain (07 §7, rule 10), kept in SQLite across restarts."""

from collections.abc import Mapping
from typing import Protocol

from maunedas_agent.store import Store


class Gated(Protocol):
    gate_key: str
    min_spacing_s: int


def spacing_for(adapter: Gated, config: Mapping[str, int]) -> int:
    """The stricter of the adapter's own spacing and the Worker's (`config.min_spacing_s`)."""
    return max(adapter.min_spacing_s, config.get(adapter.gate_key, config.get("default", 0)))


class DomainGate:
    def __init__(self, store: Store) -> None:
        self._store = store

    def try_acquire(self, key: str, min_spacing_s: float, at: int) -> bool:
        """Takes the domain for a request at `at` if its last one was at least `min_spacing_s` before."""
        cur = self._store.db.execute(
            """INSERT INTO domain_gate (domain, last_request_at) VALUES (:key, :at)
               ON CONFLICT(domain) DO UPDATE SET last_request_at = excluded.last_request_at
               WHERE domain_gate.last_request_at <= :at - :spacing_ms""",
            {"key": key, "at": at, "spacing_ms": int(min_spacing_s * 1000)},
        )
        return cur.rowcount == 1
