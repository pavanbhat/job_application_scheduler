#!/bin/zsh
set -euo pipefail

LABEL="io.pavanbhat.job-scheduler-assistant"

echo "launchctl print:"
launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null || echo "Service not loaded."
echo
echo "health endpoint:"
curl -s "http://127.0.0.1:4173/api/automation/health" || echo "Bridge not responding."
