#!/usr/bin/env bash
# Ensures the edge-tts Python venv exists, creating it if needed,
# then execs the venv's python with any arguments passed to this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VENV_DIR="${EDGE_TTS_VENV_DIR:-$PROJECT_ROOT/.edge-tts-venv}"
PYTHON_PATH="${EDGE_TTS_PYTHON_PATH:-$VENV_DIR/bin/python3}"

if [ ! -x "$PYTHON_PATH" ]; then
  echo "edge-tts venv not found at $VENV_DIR — creating it now..." >&2
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --quiet edge-tts
  echo "edge-tts venv ready." >&2
fi

exec "$PYTHON_PATH" "$@"
