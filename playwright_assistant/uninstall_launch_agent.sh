#!/bin/zsh
set -euo pipefail

LABEL="io.pavanbhat.job-scheduler-assistant"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Uninstalled launch agent: $LABEL"
