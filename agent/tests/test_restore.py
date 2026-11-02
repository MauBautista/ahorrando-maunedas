import gzip
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from maunedas_agent.backup import Mirror, dump
from maunedas_agent.restore import counts, read_dump, restore_sql
from tests.test_backup import ADMIN, MEMBER, MIGRATIONS, PAGE_1, PAGE_2, STORE, page

AGENT_DIR = Path(__file__).parents[1]
PRODUCT = "0192a5e9-0000-7000-8000-0000000000b1"
VARIANT = "0192a5e9-0000-7000-8000-0000000000c1"


def product_and_variant() -> dict:
    sync = {"created_at": 1, "updated_at": 7, "deleted_at": None, "updated_by": MEMBER}
    return page(
        {
            # A child before its parent, as a careless order would put them.
            "variants": [
                {
                    "id": VARIANT,
                    "product_id": PRODUCT,
                    "label": "1 L",
                    "measure": "volume",
                    "unit_amount": 1000,
                    "pack_count": 1,
                    "sold_by_weight": 0,
                    "primary_image_id": None,
                    "version": 8,
                    **sync,
                }
            ],
            # A child category before its parent: the same table, so only a check at the end lets it in.
            "categories": [
                {
                    "id": "0192a5e9-0000-7000-8000-0000000000d2",
                    "parent_id": "0192a5e9-0000-7000-8000-0000000000d1",
                    "name": "Lácteos",
                    "sort_order": 1,
                    "version": 6,
                    **sync,
                },
                {
                    "id": "0192a5e9-0000-7000-8000-0000000000d1",
                    "parent_id": None,
                    "name": "Refrigerados",
                    "sort_order": 1,
                    "version": 6,
                    **sync,
                },
            ],
            "products": [
                {
                    "id": PRODUCT,
                    "name": "Leche 'Lala'\nEntera",
                    "brand": None,
                    "category_id": None,
                    "display_unit": "L",
                    "notes": None,
                    "primary_image_id": None,
                    "search_key": "leche lala",
                    "version": 7,
                    **sync,
                }
            ],
        },
        {
            "variants": [8, VARIANT],
            "products": [7, PRODUCT],
            "categories": [6, "0192a5e9-0000-7000-8000-0000000000d1"],
        },
    )


@pytest.fixture
def weekly(tmp_path: Path) -> Path:
    m = Mirror(tmp_path / "mirror.sqlite", MIGRATIONS)
    for p in (PAGE_1, PAGE_2, product_and_variant()):
        m.apply(p)
    m.close()
    target = tmp_path / "weekly" / "maunedas-2026-11-01.sql.gz"
    dump(tmp_path / "mirror.sqlite", target)
    return target


def fresh_d1(tmp_path: Path) -> sqlite3.Connection:
    """A database built only from the migrations, as `wrangler d1 migrations apply` leaves it."""
    db = sqlite3.connect(tmp_path / "restored.sqlite")
    for f in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(f.read_text())
    db.execute("PRAGMA foreign_keys = ON")
    return db


def test_a_dump_restores_into_a_fresh_d1_with_every_row(weekly: Path, tmp_path: Path) -> None:
    text = gzip.decompress(weekly.read_bytes()).decode()
    sql = restore_sql(text)
    assert "BEGIN" not in sql and "COMMIT" not in sql and "_mirror_" not in sql
    assert 'INSERT INTO "sync_meta"' not in sql
    # Parents first.
    assert sql.index('INSERT INTO "products"') < sql.index('INSERT INTO "variants"')
    assert sql.index('INSERT INTO "users"') < sql.index('INSERT INTO "user_identities"')

    db = fresh_d1(tmp_path)
    db.executescript("BEGIN;\n" + sql + "COMMIT;")
    expected = counts(text)
    assert expected["users"] == 2 and expected["products"] == 1 and expected["user_identities"] == 2
    assert expected["categories"] == 2
    for table, n in expected.items():
        assert db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0] == n, table
    # Values come back exactly, quotes and new lines included.
    assert db.execute("SELECT name FROM products").fetchone()[0] == "Leche 'Lala'\nEntera"
    assert (
        db.execute("SELECT google_email FROM users WHERE id = ?", (ADMIN,)).fetchone()[0] == "mau@example.com"
    )
    assert db.execute("SELECT name FROM stores WHERE id = ?", (STORE,)).fetchone()[0] == "Costco"
    # Clients pull from the largest version of the rows on.
    assert db.execute("SELECT value FROM sync_meta WHERE key = 'version'").fetchone()[0] == 8
    assert db.execute("SELECT value FROM sync_meta WHERE key = 'schema_version'").fetchone()[0] == 1
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_the_mirror_gives_the_same_rows_as_its_dump(weekly: Path) -> None:
    mirror = weekly.parents[1] / "mirror.sqlite"
    assert restore_sql(read_dump(mirror)) == restore_sql(read_dump(weekly))
    assert mirror.read_bytes()  # still there, untouched


def test_a_broken_reference_is_refused_at_the_end(weekly: Path, tmp_path: Path) -> None:
    text = gzip.decompress(weekly.read_bytes()).decode()
    sql = restore_sql(text).replace(PRODUCT, "0192a5e9-0000-7000-8000-0000000000ff", 1)
    db = fresh_d1(tmp_path)
    with pytest.raises(sqlite3.IntegrityError):
        db.executescript("BEGIN;\n" + sql + "COMMIT;")


def test_the_command_writes_the_sql_or_the_counts(weekly: Path) -> None:
    run = lambda *args: subprocess.run(  # noqa: E731
        [sys.executable, "-m", "maunedas_agent.restore", *args], cwd=AGENT_DIR, capture_output=True, text=True
    )
    sql = run(str(weekly))
    assert sql.returncode == 0 and sql.stdout.startswith("-- Rows of a weekly dump")
    listed = run(str(weekly), "--counts")
    assert listed.returncode == 0 and '"users": 2' in listed.stdout
    assert run().returncode == 2


def test_tables_that_reference_each_other_are_named() -> None:
    cyclic = """CREATE TABLE a (id TEXT PRIMARY KEY, b_id TEXT REFERENCES b(id));
CREATE TABLE b (id TEXT PRIMARY KEY, a_id TEXT REFERENCES a(id));"""
    with pytest.raises(ValueError, match=r"\['a', 'b'\]"):
        counts(cyclic)
