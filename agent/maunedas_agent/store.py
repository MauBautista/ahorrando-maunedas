"""The agent's local SQLite (07 §4): listings to check, their schedule, the outbox and small state."""

import json
import random
import sqlite3
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS listing_cfg (
  id            TEXT PRIMARY KEY,
  adapter       TEXT NOT NULL,
  url           TEXT NOT NULL,
  canonical_url TEXT,
  external_id   TEXT,
  store_id      TEXT NOT NULL,
  interval_min  INTEGER,
  active        INTEGER NOT NULL,
  version       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS store_defaults (store_id TEXT PRIMARY KEY, interval_min INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS schedule (
  listing_id       TEXT PRIMARY KEY,
  next_check_at    INTEGER NOT NULL,
  backoff_level    INTEGER NOT NULL DEFAULT 0,
  block_streak     INTEGER NOT NULL DEFAULT 0,
  last_status      TEXT,
  last_checked_at  INTEGER
);
CREATE TABLE IF NOT EXISTS outbox (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS domain_gate (domain TEXT PRIMARY KEY, last_request_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

CURSOR_KEY = "listings_cursor"
MIN_SPACING_KEY = "min_spacing_s"
# Check requests already scheduled: /work repeats one until its result arrives, and it is checked once.
CHECK_SEEN_KEY = "check_now_seen"
POLL_TICK_KEY = "poll_tick_at"
WORK_OK_KEY = "work_ok_at"
# stores.default_check_interval_min when the Worker has not sent the store yet (docs/esquema-d1.sql).
DEFAULT_INTERVAL_MIN = 480

# Each listing's own interval, else its store's, else the default; and when it was last checked.
_EFFECTIVE_INTERVALS = """
    SELECT s.listing_id, COALESCE(l.interval_min, d.interval_min, ?) AS interval_min, s.last_checked_at
    FROM schedule s JOIN listing_cfg l ON l.id = s.listing_id
    LEFT JOIN store_defaults d ON d.store_id = l.store_id
"""


@dataclass(frozen=True)
class DueListing:
    id: str
    adapter: str
    url: str
    interval_min: int
    backoff_level: int
    block_streak: int


@dataclass(frozen=True)
class Pending:
    seq: int
    listing_id: str
    payload: dict[str, Any]


def now_ms() -> int:
    return int(time.time() * 1000)


class Store:
    """One connection, used from the event loop's thread only."""

    def __init__(self, path: Path | str) -> None:
        if isinstance(path, Path):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def tx(self) -> Iterator[None]:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        self.db.execute("COMMIT")

    # kv

    def get(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return None if row is None else str(row["value"])

    def put(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def cursor(self) -> list[Any]:
        raw = self.get(CURSOR_KEY)
        return json.loads(raw) if raw else [0, ""]

    # What /work answers (07 §5.1)

    def apply_work(
        self,
        work: dict[str, Any],
        now: int | None = None,
        jitter: Callable[[float, float], float] = random.uniform,
    ) -> None:
        """Listings, removals and store defaults of one /work answer, and its cursor, in one transaction.

        A listing whose interval changed is rescheduled from its last check (T-224).
        """
        listings = work["listings"]
        at = now_ms() if now is None else now
        with self.tx():
            before = self._effective_intervals()
            for item in listings["upserts"]:
                self.db.execute(
                    """INSERT INTO listing_cfg (id, adapter, url, canonical_url, external_id, store_id,
                         interval_min, active, version)
                       VALUES (:id, :adapter, :url, :canonical_url, :external_id, :store_id, :interval_min,
                         :active, :version)
                       ON CONFLICT(id) DO UPDATE SET adapter = excluded.adapter, url = excluded.url,
                         canonical_url = excluded.canonical_url, external_id = excluded.external_id,
                         store_id = excluded.store_id, interval_min = excluded.interval_min,
                         active = excluded.active, version = excluded.version""",
                    item,
                )
            for listing_id in listings["removed"]:
                self.db.execute("DELETE FROM listing_cfg WHERE id = ?", (listing_id,))
                self.db.execute("DELETE FROM schedule WHERE listing_id = ?", (listing_id,))
            for store_id, interval in work["store_defaults"].items():
                self.db.execute(
                    """INSERT INTO store_defaults (store_id, interval_min) VALUES (?, ?)
                       ON CONFLICT(store_id) DO UPDATE SET interval_min = excluded.interval_min""",
                    (store_id, interval),
                )
            self.put(CURSOR_KEY, json.dumps(listings["cursor"]))
            self.put(MIN_SPACING_KEY, json.dumps(work["config"]["min_spacing_s"]))
            for listing_id, (interval_min, last_checked_at) in self._effective_intervals().items():
                unchanged = before.get(listing_id, (interval_min, None))[0] == interval_min
                if unchanged or last_checked_at is None:
                    continue
                # The interval ±10 % after a good check, as loops/scrape.next_check. A listing waiting on its
                # backoff keeps it, and one already due (a "Revisar ahora" among them) stays due.
                self.db.execute(
                    """UPDATE schedule SET next_check_at = ?
                       WHERE listing_id = ? AND backoff_level = 0 AND next_check_at > ?""",
                    (last_checked_at + int(interval_min * 60_000 * jitter(0.9, 1.1)), listing_id, at),
                )

    def _effective_intervals(self) -> dict[str, tuple[int, int | None]]:
        rows = self.db.execute(_EFFECTIVE_INTERVALS, (DEFAULT_INTERVAL_MIN,)).fetchall()
        return {r["listing_id"]: (r["interval_min"], r["last_checked_at"]) for r in rows}

    def request_checks(self, ids: list[str], at: int) -> list[str]:
        """Schedules "Revisar ahora" (07 §7) once per request; returns the listings scheduled now."""
        seen = set(json.loads(self.get(CHECK_SEEN_KEY) or "[]"))
        scheduled = []
        with self.tx():
            for listing_id in ids:
                if listing_id in seen:
                    continue
                known = self.db.execute(
                    "SELECT 1 FROM listing_cfg WHERE id = ? AND active = 1", (listing_id,)
                ).fetchone()
                if known is None:
                    continue
                self.db.execute(
                    """INSERT INTO schedule (listing_id, next_check_at) VALUES (?, ?)
                       ON CONFLICT(listing_id)
                       DO UPDATE SET next_check_at = min(next_check_at, excluded.next_check_at)""",
                    (listing_id, at),
                )
                scheduled.append(listing_id)
            # A request leaves the list once its result reached the Worker; a new one can then be scheduled.
            self.put(CHECK_SEEN_KEY, json.dumps(sorted((seen | set(scheduled)) & set(ids))))
        return scheduled

    # The agent's report on itself (07 §5.1 info)

    def outbox_size(self) -> int:
        return int(self.db.execute("SELECT count(*) FROM outbox").fetchone()[0])

    def due_count(self, at: int) -> int:
        return int(
            self.db.execute(
                """SELECT count(*) FROM schedule s JOIN listing_cfg l ON l.id = s.listing_id
                   WHERE l.active = 1 AND s.next_check_at <= ?""",
                (at,),
            ).fetchone()[0]
        )

    def min_spacing(self) -> dict[str, int]:
        raw = self.get(MIN_SPACING_KEY)
        return json.loads(raw) if raw else {}

    # Schedule (07 §7)

    def ensure_scheduled(self, at: int) -> int:
        """Active listings without a schedule are due now; returns how many."""
        cur = self.db.execute(
            """INSERT INTO schedule (listing_id, next_check_at)
               SELECT id, ? FROM listing_cfg l
               WHERE l.active = 1 AND NOT EXISTS (SELECT 1 FROM schedule s WHERE s.listing_id = l.id)""",
            (at,),
        )
        return cur.rowcount

    def due_listings(self, at: int, limit: int) -> list[DueListing]:
        rows = self.db.execute(
            """SELECT l.id, l.adapter, COALESCE(l.canonical_url, l.url) AS url,
                      COALESCE(l.interval_min, d.interval_min, ?) AS interval_min,
                      s.backoff_level, s.block_streak
               FROM schedule s JOIN listing_cfg l ON l.id = s.listing_id
               LEFT JOIN store_defaults d ON d.store_id = l.store_id
               WHERE l.active = 1 AND s.next_check_at <= ?
               ORDER BY s.next_check_at, l.id LIMIT ?""",
            (DEFAULT_INTERVAL_MIN, at, limit),
        ).fetchall()
        return [DueListing(**dict(r)) for r in rows]

    def reschedule(
        self,
        listing_id: str,
        status: str,
        checked_at: int,
        next_check_at: int,
        backoff_level: int,
        block_streak: int,
    ) -> None:
        self.db.execute(
            """UPDATE schedule SET next_check_at = ?, backoff_level = ?, block_streak = ?, last_status = ?,
                 last_checked_at = ?
               WHERE listing_id = ?""",
            (next_check_at, backoff_level, block_streak, status, checked_at, listing_id),
        )

    # Outbox: results not yet accepted by the Worker

    def outbox_add(self, listing_id: str, payload: dict[str, Any], at: int) -> None:
        self.db.execute(
            "INSERT INTO outbox (listing_id, payload, created_at) VALUES (?, ?, ?)",
            (listing_id, json.dumps(payload, separators=(",", ":")), at),
        )

    def outbox_batch(self, limit: int) -> list[Pending]:
        rows = self.db.execute("SELECT seq, listing_id, payload FROM outbox ORDER BY seq LIMIT ?", (limit,))
        return [Pending(r["seq"], r["listing_id"], json.loads(r["payload"])) for r in rows.fetchall()]

    def outbox_delete(self, seqs: list[int]) -> None:
        self.db.executemany("DELETE FROM outbox WHERE seq = ?", [(s,) for s in seqs])

    def blocked_adapters(self) -> list[str]:
        rows = self.db.execute(
            """SELECT DISTINCT l.adapter FROM schedule s JOIN listing_cfg l ON l.id = s.listing_id
               WHERE l.active = 1 AND s.last_status = 'blocked' ORDER BY l.adapter"""
        ).fetchall()
        return [str(r["adapter"]) for r in rows]
