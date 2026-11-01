import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from maunedas_agent.__main__ import every
from maunedas_agent.health import healthy
from maunedas_agent.store import now_ms

AGENT_DIR = Path(__file__).parents[1]


async def test_a_loop_survives_a_failure_and_stops() -> None:
    stop = asyncio.Event()
    calls = []

    async def step() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        if len(calls) == 3:
            stop.set()

    await asyncio.wait_for(every(0.01, step, stop, "test"), timeout=5)
    assert len(calls) == 3


def test_the_agent_starts_ticks_and_stops_cleanly_on_sigterm(tmp_path: Path) -> None:
    """Without a reachable Worker: the store, the JSON logs, the healthcheck and a prompt stop."""
    token = "s" * 64
    env = {
        **os.environ,
        "API_BASE": "http://127.0.0.1:9",
        "AGENT_TOKEN": token,
        "DATA_DIR": str(tmp_path),
        "POLL_INTERVAL_S": "60",
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "maunedas_agent"], env=env, cwd=AGENT_DIR, stdout=subprocess.PIPE, text=True
    )
    try:
        deadline = time.monotonic() + 30
        while not healthy(tmp_path / "agent.sqlite", now_ms()):
            assert time.monotonic() < deadline, "no poll tick"
            time.sleep(0.2)
        proc.send_signal(signal.SIGTERM)
        # Docker waits 10 s before killing; a retry in progress must not hold the stop.
        out, _ = proc.communicate(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode == 0
    events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert events[0] == "agent_started"
    assert events[-1] == "agent_stopped"
    assert token not in out


@pytest.mark.parametrize("missing", ["API_BASE", "AGENT_TOKEN"])
def test_the_agent_refuses_to_start_without_its_settings(tmp_path: Path, missing: str) -> None:
    env = {k: v for k, v in os.environ.items() if k not in ("API_BASE", "AGENT_TOKEN")}
    # Run from tmp_path so a real agent/.env cannot fill the gap.
    env |= {
        "API_BASE": "http://127.0.0.1:9",
        "AGENT_TOKEN": "x",
        "DATA_DIR": str(tmp_path),
        "PYTHONPATH": str(AGENT_DIR),
    }
    del env[missing]
    res = subprocess.run(
        [sys.executable, "-m", "maunedas_agent"], env=env, cwd=tmp_path, capture_output=True, text=True
    )
    assert res.returncode != 0
    assert missing.lower() in res.stderr
