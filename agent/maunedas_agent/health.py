"""Container healthcheck (07 §13): unhealthy if the poll loop has not ticked for 3 minutes."""

import os
import sqlite3
import sys
from pathlib import Path

from maunedas_agent.store import POLL_TICK_KEY, now_ms

MAX_SILENCE_MS = 3 * 60_000


def healthy(db_path: Path, at: int) -> bool:
    if not db_path.exists():
        return False
    try:
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            row = db.execute("SELECT value FROM kv WHERE key = ?", (POLL_TICK_KEY,)).fetchone()
        finally:
            db.close()
    except sqlite3.Error:
        return False
    return row is not None and at - int(row[0]) < MAX_SILENCE_MS


if __name__ == "__main__":
    sys.exit(0 if healthy(Path(os.environ.get("DATA_DIR", "/data")) / "agent.sqlite", now_ms()) else 1)
