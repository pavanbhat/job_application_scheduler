#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLED_NODE="/Users/pbhat/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ -x "$BUNDLED_NODE" ]; then
  exec "$BUNDLED_NODE" "$SCRIPT_DIR/server.js" "$@"
fi

exec node "$SCRIPT_DIR/server.js" "$@"
