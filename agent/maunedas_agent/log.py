"""JSON logs to stdout (07 §13). Tokens, cookies and authorization never reach a log line."""

import logging
from collections.abc import MutableMapping
from typing import Any

import structlog

SECRET_KEYS = frozenset(
    {"token", "agent_token", "authorization", "cookie", "cookies", "set-cookie", "password"}
)


def drop_secrets(_logger: Any, _method: str, event: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key in [k for k in event if k.lower() in SECRET_KEYS]:
        event[key] = "[oculto]"
    return event


def setup(level: str = "INFO") -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            drop_secrets,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping().get(level.upper(), 20)
        ),
        # Without a file, each line goes to the sys.stdout of that moment.
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )


def get(name: str = "agent") -> structlog.typing.FilteringBoundLogger:
    return structlog.get_logger(name)
