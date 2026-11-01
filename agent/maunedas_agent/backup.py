"""The home copy of D1 (07 §10): a mirror fed by /agent/v1/backup/pull and a weekly compressed dump."""

import gzip
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from maunedas_agent.store import now_ms

# The mirror's own bookkeeping; never part of a dump (a restore must not create it in D1).
OWN_PREFIX = "_mirror_"


class SchemaMismatch(Exception):
    """A row the mirror's schema cannot hold: a migration is missing from the image."""


class Mirror:
    """D1's schema from apps/api/migrations, kept up to date page by page."""

    def __init__(self, path: Path, migrations_dir: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(str(path), isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            f"CREATE TABLE IF NOT EXISTS {OWN_PREFIX}migrations (name TEXT PRIMARY KEY, applied_at INTEGER)"
        )
        self.db.execute(
            f"""CREATE TABLE IF NOT EXISTS {OWN_PREFIX}cursors
                (table_name TEXT PRIMARY KEY, position INTEGER NOT NULL, last TEXT NOT NULL)"""
        )
        self.migrate(migrations_dir)

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def _tx(self) -> Iterator[None]:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        self.db.execute("COMMIT")

    def migrate(self, folder: Path) -> list[str]:
        """Applies the migrations not applied yet, each with its record in one transaction."""
        done = {r[0] for r in self.db.execute(f"SELECT name FROM {OWN_PREFIX}migrations")}
        applied = []
        for file in sorted(folder.glob("*.sql")):
            if file.name in done:
                continue
            script = file.read_text(encoding="utf-8")
            try:
                record = f"INSERT INTO {OWN_PREFIX}migrations VALUES ('{file.name}', {now_ms()})"
                self.db.executescript(f"BEGIN;\n{script}\n;{record};\nCOMMIT;")
            except sqlite3.Error:
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                raise
            applied.append(file.name)
        return applied

    def cursors(self) -> dict[str, list[Any]]:
        return {t: [p, last] for t, p, last in self.db.execute(f"SELECT * FROM {OWN_PREFIX}cursors")}

    def _columns(self, table: str) -> tuple[list[str], list[str]]:
        info = self.db.execute(f'PRAGMA table_info("{table}")').fetchall()
        if not info:
            raise SchemaMismatch(f"tabla desconocida en el espejo: {table}")
        return [r[1] for r in info], [r[1] for r in sorted((r for r in info if r[5]), key=lambda r: r[5])]

    def apply(self, page: dict[str, Any]) -> int:
        """One backup/pull answer with its cursors, in one transaction; returns the rows written."""
        written = 0
        with self._tx():
            for table, rows in page["changes"].items():
                columns, pk = self._columns(table)
                if table in page["replace"]:
                    self.db.execute(f'DELETE FROM "{table}"')
                for row in rows:
                    extra = set(row) - set(columns)
                    if extra:
                        raise SchemaMismatch(f"{table}: columnas que el espejo no tiene: {sorted(extra)}")
                    names = list(row)
                    quoted = ", ".join(f'"{c}"' for c in names)
                    updates = ", ".join(f'"{c}" = excluded."{c}"' for c in names if c not in pk)
                    conflict = ", ".join(f'"{c}"' for c in pk)
                    self.db.execute(
                        f'INSERT INTO "{table}" ({quoted}) VALUES ({", ".join("?" for _ in names)}) '
                        f"ON CONFLICT({conflict}) DO " + (f"UPDATE SET {updates}" if updates else "NOTHING"),
                        [row[c] for c in names],
                    )
                    written += 1
            for table, (position, last) in page["cursors"].items():
                self.db.execute(
                    f"""INSERT INTO {OWN_PREFIX}cursors VALUES (?, ?, ?)
                        ON CONFLICT(table_name)
                        DO UPDATE SET position = excluded.position, last = excluded.last""",
                    (table, position, last),
                )
        return written

    def counts(self) -> dict[str, int]:
        tables = [
            r[0]
            for r in self.db.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            if not r[0].startswith(OWN_PREFIX) and not r[0].startswith("sqlite_")
        ]
        return {t: int(self.db.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]) for t in tables}


def dump(mirror_path: Path, target: Path) -> int:
    """`.dump` of the mirror, gzip-compressed, without its own bookkeeping; returns the file's size."""
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".partial")
    db = sqlite3.connect(f"file:{mirror_path}?mode=ro", uri=True)
    try:
        with gzip.open(partial, "wt", encoding="utf-8") as out:
            for statement in db.iterdump():
                if OWN_PREFIX in statement.split("(", 1)[0]:
                    continue
                out.write(statement + "\n")
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    finally:
        db.close()
    # A dump only exists once complete.
    partial.replace(target)
    return target.stat().st_size


def rotate(folder: Path, keep: int) -> list[str]:
    """Keeps the newest `keep` weekly dumps (by date in the name); returns the removed ones."""
    files = sorted(folder.glob("maunedas-*.sql.gz"))
    removed = files[:-keep] if keep > 0 else files
    for f in removed:
        f.unlink()
    return [f.name for f in removed]
