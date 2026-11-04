"""The image container's healthcheck: unhealthy if its loop has not ticked for 5 minutes."""

import os
import sys
import time
from pathlib import Path

MAX_SILENCE_S = 5 * 60
HEARTBEAT = "images.alive"


def healthy(heartbeat: Path, now: float) -> bool:
    try:
        return now - heartbeat.stat().st_mtime < MAX_SILENCE_S
    except OSError:
        return False


if __name__ == "__main__":
    sys.exit(0 if healthy(Path(os.environ.get("DATA_DIR", "/data")) / HEARTBEAT, time.time()) else 1)
