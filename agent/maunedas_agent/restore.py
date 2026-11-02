"""A weekly dump (07 §10) as SQL that D1 accepts (RF-BAK-04, T-231).

The dump is SQLite's `.dump` of the mirror: its tables in name order inside BEGIN/COMMIT, which D1
refuses, and its rows in an order that breaks foreign keys. The schema comes from D1's own migrations
instead, so this keeps only the rows: parents first, foreign keys checked at the end, `sync_meta` left to
the migrations and its `version` set to the largest of the rows (clients pull from there on).

It also reads the daily mirror itself, a day old at most, where the weekly dump can be a week old:

    python -m maunedas_agent.restore /data/backups/mirror.sqlite > restore.sql
    python -m maunedas_agent.restore weekly/maunedas-2026-11-01.sql.gz --counts
"""

import gzip
import json
import sqlite3
import sys
from pathlib import Path

# Rows the migrations write, or that are not data.
SKIPPED = ("sync_meta", "d1_migrations")


def _load(dump: str) -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(dump)
    return db


def _tables(db: sqlite3.Connection) -> list[str]:
    """Data tables, parents before the tables that reference them."""
    names = [
        r[0]
        for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        if not r[0].startswith(("sqlite_", "_mirror_")) and r[0] not in SKIPPED
    ]
    parents = {t: {r[2] for r in db.execute(f'PRAGMA foreign_key_list("{t}")') if r[2] != t} for t in names}
    ordered: list[str] = []
    while len(ordered) < len(names):
        ready = [
            t for t in names if t not in ordered and parents[t] <= set(ordered) | (parents[t] - set(names))
        ]
        if not ready:
            raise ValueError(f"ciclo de llaves foráneas entre {sorted(set(names) - set(ordered))}")
        ordered += ready
    return ordered


def _columns(db: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]


def counts(dump: str) -> dict[str, int]:
    """Rows per data table: what the restored database must hold."""
    db = _load(dump)
    return {t: int(db.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]) for t in _tables(db)}


def restore_sql(dump: str) -> str:
    db = _load(dump)
    out = [
        "-- Rows of a weekly dump (07 §10), for a D1 whose migrations were just applied (T-231).",
        "PRAGMA defer_foreign_keys = true;",
    ]
    top = 0
    for table in _tables(db):
        cols = _columns(db, table)
        if "version" in cols:
            top = max(top, int(db.execute(f'SELECT COALESCE(max(version), 0) FROM "{table}"').fetchone()[0]))
        names = ", ".join(f'"{c}"' for c in cols)
        # SQLite quotes each value itself: text, numbers, blobs and NULL come back exactly.
        values = " || ', ' || ".join(f'quote("{c}")' for c in cols)
        for (row,) in db.execute(f'SELECT {values} FROM "{table}"'):
            out.append(f'INSERT INTO "{table}" ({names}) VALUES ({row});')
    # A number, not a query over every table: D1 limits compound SELECTs.
    out.append(f"UPDATE sync_meta SET value = max(value, {top}) WHERE key = 'version';")
    return "\n".join(out) + "\n"


def read_dump(path: Path) -> str:
    if path.suffix == ".sqlite":
        # Read-only: the agent may be writing the mirror.
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            return "\n".join(db.iterdump())
        finally:
            db.close()
    raw = path.read_bytes()
    return gzip.decompress(raw).decode("utf-8") if path.suffix == ".gz" else raw.decode("utf-8")


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3) or (len(argv) == 3 and argv[2] != "--counts"):
        print(
            "uso: python -m maunedas_agent.restore <volcado.sql.gz | mirror.sqlite> [--counts]",
            file=sys.stderr,
        )
        return 2
    dump = read_dump(Path(argv[1]))
    if len(argv) == 3:
        print(json.dumps(counts(dump), indent=1, sort_keys=True))
    else:
        sys.stdout.write(restore_sql(dump))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
