import json
import sqlite3

import pytest

from maunedas_agent.store import CURSOR_KEY, MIN_SPACING_KEY, Store
from tests.support import L1, L2, L3, STORE, listing, work


def rows(store: Store, sql: str) -> list[tuple]:
    return [tuple(r) for r in store.db.execute(sql).fetchall()]


def test_a_new_store_creates_its_tables_and_starts_from_the_first_cursor(store: Store) -> None:
    tables = {r[0] for r in rows(store, "SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"listing_cfg", "store_defaults", "schedule", "outbox", "domain_gate", "kv"} <= tables
    assert store.cursor() == [0, ""]
    assert store.db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_apply_work_keeps_listings_defaults_cursor_and_spacing(store: Store) -> None:
    store.apply_work(work([listing(L1, 5), listing(L2, 6, interval_min=60, active=0)]))
    assert rows(store, "SELECT id, interval_min, active, version FROM listing_cfg ORDER BY id") == [
        (L1, None, 1, 5),
        (L2, 60, 0, 6),
    ]
    assert rows(store, "SELECT store_id, interval_min FROM store_defaults") == [(STORE, 480)]
    assert store.cursor() == [6, L2]
    assert json.loads(store.get(MIN_SPACING_KEY) or "") == {"amazon_mx": 45, "default": 20}

    # An update and a removal; the removed listing loses its schedule too.
    store.db.execute("INSERT INTO schedule (listing_id, next_check_at) VALUES (?, 1)", (L2,))
    store.apply_work(
        work([listing(L1, 7, url="https://www.amazon.com.mx/dp/X")], removed=[L2], cursor=[8, L2])
    )
    assert rows(store, "SELECT id, url, version FROM listing_cfg") == [
        (L1, "https://www.amazon.com.mx/dp/X", 7)
    ]
    assert rows(store, "SELECT * FROM schedule") == []
    assert store.cursor() == [8, L2]


def test_a_bad_answer_changes_nothing(store: Store) -> None:
    store.apply_work(work([listing(L1, 5)]))
    broken = listing(L2, 6)
    del broken["store_id"]
    with pytest.raises(sqlite3.ProgrammingError):
        store.apply_work(work([listing(L3, 6), broken]))
    assert rows(store, "SELECT id FROM listing_cfg") == [(L1,)]
    assert store.get(CURSOR_KEY) == json.dumps([5, L1])


def test_check_now_is_scheduled_once_per_request(store: Store) -> None:
    store.apply_work(work([listing(L1, 5), listing(L2, 6, active=0)]))
    store.db.execute("INSERT INTO schedule (listing_id, next_check_at) VALUES (?, 999999)", (L1,))
    # Inactive and unknown listings are not checked.
    assert store.request_checks([L1, L2, L3], 100) == [L1]
    assert rows(store, "SELECT listing_id, next_check_at FROM schedule") == [(L1, 100)]
    # /work repeats it until the result reaches the Worker: not scheduled again after the check.
    store.db.execute("UPDATE schedule SET next_check_at = 5000 WHERE listing_id = ?", (L1,))
    assert store.request_checks([L1], 200) == []
    assert rows(store, "SELECT next_check_at FROM schedule") == [(5000,)]
    # Once it left the list, a new request is scheduled; never later than it already was.
    assert store.request_checks([], 300) == []
    assert store.request_checks([L1], 400) == [L1]
    assert rows(store, "SELECT next_check_at FROM schedule") == [(400,)]
    store.db.execute("UPDATE schedule SET next_check_at = 10 WHERE listing_id = ?", (L1,))
    store.request_checks([], 500)
    store.request_checks([L1], 600)
    assert rows(store, "SELECT next_check_at FROM schedule") == [(10,)]


def test_the_report_counts_outbox_due_and_blocked_adapters(store: Store) -> None:
    store.apply_work(
        work(
            [listing(L1, 5), listing(L2, 6, adapter="sams_mx"), listing(L3, 7, adapter="costco_mx", active=0)]
        )
    )
    store.db.executemany(
        "INSERT INTO schedule (listing_id, next_check_at, last_status) VALUES (?, ?, ?)",
        [(L1, 100, "ok"), (L2, 300, "blocked"), (L3, 100, "blocked")],
    )
    store.db.execute("INSERT INTO outbox (listing_id, payload, created_at) VALUES (?, '{}', 1)", (L1,))
    assert store.outbox_size() == 1
    assert store.due_count(200) == 1
    assert store.due_count(300) == 2
    # Only listings still tracked count, as for due.
    assert store.blocked_adapters() == ["sams_mx"]
