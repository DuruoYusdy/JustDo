#!/usr/bin/env bash
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${LITELLM_PYTHON:-$SCRIPT_DIR/.venv/bin/python}" "$SCRIPT_DIR/start.py" "${1:-serve}"
