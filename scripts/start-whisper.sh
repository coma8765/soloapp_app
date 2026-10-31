#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export HF_HUB_OFFLINE=1
exec .cache/whisper-venv/bin/python scripts/whisper_service.py \
  --model "${WHISPER_MODEL:-.cache/whisper-model}" --port "${WHISPER_PORT:-8178}"
