import os
import subprocess
import sys
from pathlib import Path

from maunedas_agent.health import healthy
from maunedas_agent.store import POLL_TICK_KEY, Store


def test_healthy_only_with_a_recent_poll_tick(tmp_path: Path) -> None:
    db = tmp_path / "agent.sqlite"
    assert healthy(db, 1_000_000) is False
    store = Store(db)
    assert healthy(db, 1_000_000) is False
    store.put(POLL_TICK_KEY, "1000000")
    assert healthy(db, 1_000_000 + 179_999) is True
    assert healthy(db, 1_000_000 + 180_000) is False
    store.close()
    (tmp_path / "junk.sqlite").write_text("not a database")
    assert healthy(tmp_path / "junk.sqlite", 1) is False


def test_the_module_exits_with_the_verdict(tmp_path: Path) -> None:
    def run() -> int:
        env = {**os.environ, "DATA_DIR": str(tmp_path)}
        return subprocess.run(
            [sys.executable, "-m", "maunedas_agent.health"], env=env, cwd=Path(__file__).parents[1]
        ).returncode

    assert run() == 1
    store = Store(tmp_path / "agent.sqlite")
    store.put(POLL_TICK_KEY, str(10**15))
    assert run() == 0
    store.close()
