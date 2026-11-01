"""What the loops share."""

from dataclasses import dataclass

from maunedas_agent.api import AgentApi
from maunedas_agent.config import Settings
from maunedas_agent.store import Store


@dataclass
class AgentContext:
    settings: Settings
    store: Store
    api: AgentApi
    # Last failure of any loop, reported in /work's info until a poll succeeds.
    last_error: str | None = None
