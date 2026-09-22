#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SHARED_DIR="$SCRIPT_DIR/../shared"

if [[ ! -r "$SHARED_DIR/proxy_app.py" ]]; then
  echo 'Missing shared directory; deploy shared/ alongside native/.' >&2
  exit 1
fi

ENV_FILE="${LITELLM_ENV_FILE:-$SCRIPT_DIR/.env}"
if [[ ! -r "$ENV_FILE" ]]; then
  echo 'Missing readable .env; copy and configure .env.example first.' >&2
  exit 1
fi

# Administrator-owned, trusted shell configuration only.
set -a
source "$ENV_FILE"
set +a

PYTHON_BIN="${LITELLM_PYTHON:-$SCRIPT_DIR/.venv/bin/python}"
export CONFIG_FILE_PATH="${CONFIG_FILE_PATH:-$SCRIPT_DIR/config.yaml}"
export PYTHONDONTWRITEBYTECODE=1

: "${DATABASE_URL:?DATABASE_URL must be configured}"

if [[ ! -x "$PYTHON_BIN" || ! -r "$CONFIG_FILE_PATH" ]]; then
  echo 'Python executable or LiteLLM config missing; check LITELLM_PYTHON and CONFIG_FILE_PATH.' >&2
  exit 1
fi
cd -- "$SCRIPT_DIR"

# Forward signals directly to the uvicorn supervisor by replacing this shell.
exec "$PYTHON_BIN" -m uvicorn proxy_app:create_app --factory \
  --app-dir "$SHARED_DIR" --host "${LITELLM_HOST:-127.0.0.1}" \
  --port "${LITELLM_PORT:-9108}" --workers "${LITELLM_WORKERS:-2}"
