# agent/Dockerfile — build context: the repo root (07 §12)
FROM mcr.microsoft.com/playwright/python:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends rclone sqlite3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY agent/pyproject.toml agent/uv.lock ./
RUN uv sync --frozen --no-dev --extra browser
COPY agent/maunedas_agent ./maunedas_agent
COPY apps/api/migrations ./migrations
# The venv's python directly: `uv run` would install the dev group at start.
ENV PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s CMD ["python", "-m", "maunedas_agent.health"]
CMD ["python", "-m", "maunedas_agent"]
