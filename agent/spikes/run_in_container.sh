#!/usr/bin/env bash
# Spike B runner, executed inside mcr.microsoft.com/playwright/python:v1.63.0-noble
# (see docs/spikes/spike-b-scraping.md). The image has no venv module, so pinned deps go to a
# throwaway --target directory; the container is removed afterwards.
set -euo pipefail
python3 -m pip install -q --disable-pip-version-check --break-system-packages --target /tmp/py \
  httpx==0.28.1 selectolax==1.0.1 psutil==7.2.2 playwright==1.63.0
PYTHONPATH=/tmp/py python3 /work/scrape_probe.py /work/out 2>&1 | tee /work/out/run.log
