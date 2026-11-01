import json

import pytest

from maunedas_agent import log


def test_logs_are_json_lines_without_secrets(capsys: pytest.CaptureFixture[str]) -> None:
    log.setup("INFO")
    logger = log.get("test")
    logger.info("work_failed", listing_id="L1", token="abc", Authorization="Bearer abc", cookies={"s": "1"})
    logger.debug("hidden")
    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["event"] == "work_failed"
    assert entry["level"] == "info"
    assert entry["listing_id"] == "L1"
    assert entry["token"] == entry["Authorization"] == entry["cookies"] == "[oculto]"
    assert "abc" not in lines[0]
    assert entry["timestamp"].endswith("Z")
