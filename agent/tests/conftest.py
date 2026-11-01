from pathlib import Path

import pytest

from maunedas_agent.config import Settings
from maunedas_agent.store import Store

API = "https://agent.test"
TOKEN = "t" * 64


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, api_base=API, agent_token=TOKEN, data_dir=tmp_path)  # type: ignore[call-arg]


@pytest.fixture
def store(settings: Settings):
    s = Store(settings.db_path)
    yield s
    s.close()
