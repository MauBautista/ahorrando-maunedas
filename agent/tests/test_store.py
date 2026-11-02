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


MIN = 60_000
LAST = 1_000_000_000


def schedule(
    store: Store, listing_id: str, next_check_at: int, backoff: int = 0, last: int | None = LAST
) -> None:
    store.db.execute(
        """INSERT INTO schedule (listing_id, next_check_at, backoff_level, last_checked_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(listing_id) DO UPDATE SET next_check_at = excluded.next_check_at,
             backoff_level = excluded.backoff_level, last_checked_at = excluded.last_checked_at""",
        (listing_id, next_check_at, backoff, last),
    )


def next_checks(store: Store) -> dict[str, int]:
    return dict(rows(store, "SELECT listing_id, next_check_at FROM schedule"))


def test_a_new_interval_counts_from_the_last_check(store: Store) -> None:
    store.apply_work(work([listing(L1, 5), listing(L2, 6, interval_min=240)]))
    schedule(store, L1, LAST + 480 * MIN)
    schedule(store, L2, LAST + 240 * MIN)
    now = LAST + 60 * MIN
    exact = lambda a, b: 1.0  # noqa: E731

    # 8 h of the store to 4 h, and 4 h to a day: both from the last check, not from now.
    store.apply_work(work([listing(L1, 7, interval_min=240), listing(L2, 8, interval_min=1440)]), now, exact)
    assert next_checks(store) == {L1: LAST + 240 * MIN, L2: LAST + 1440 * MIN}
    # Back to the store's: its 480 min.
    store.apply_work(work([listing(L1, 9, interval_min=None)]), now, exact)
    assert next_checks(store)[L1] == LAST + 480 * MIN
    # With the jitter of a good check.
    store.apply_work(
        work([listing(L1, 10, interval_min=720)]), now, lambda a, b: (a, b) == (0.9, 1.1) and 1.05
    )
    assert next_checks(store)[L1] == LAST + int(720 * MIN * 1.05)


def test_the_store_interval_moves_only_the_listings_that_follow_it(store: Store) -> None:
    store.apply_work(work([listing(L1, 5), listing(L2, 6, interval_min=240)]))
    schedule(store, L1, LAST + 480 * MIN)
    schedule(store, L2, LAST + 240 * MIN)
    answer = work(cursor=[6, L2])
    answer["store_defaults"] = {STORE: 720}
    store.apply_work(answer, LAST, lambda a, b: 1.0)
    assert next_checks(store) == {L1: LAST + 720 * MIN, L2: LAST + 240 * MIN}


def test_a_change_leaves_alone_backoff_due_unchecked_and_unchanged_listings(store: Store) -> None:
    store.apply_work(work([listing(L1, 5), listing(L2, 6), listing(L3, 7)]))
    schedule(store, L1, LAST + 30 * MIN, backoff=2)  # waiting after an error
    schedule(store, L2, LAST, last=LAST - 480 * MIN)  # due: "Revisar ahora" or overdue
    schedule(store, L3, LAST + 480 * MIN, last=None)  # never checked
    before = next_checks(store)
    changed = [
        listing(L1, 8, interval_min=120),
        listing(L2, 9, interval_min=120),
        listing(L3, 10, interval_min=120),
    ]
    store.apply_work(work(changed), LAST + MIN, lambda a, b: 1.0)
    assert next_checks(store) == before
    # Another field changes, the interval does not: the schedule stays.
    schedule(store, L3, LAST + 120 * MIN)
    store.apply_work(
        work([listing(L3, 11, interval_min=120, url="https://www.amazon.com.mx/dp/Y")]),
        LAST,
        lambda a, b: 9.0,
    )
    assert next_checks(store)[L3] == LAST + 120 * MIN


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
