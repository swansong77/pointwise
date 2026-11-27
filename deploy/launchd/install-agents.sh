#!/usr/bin/env bash
# macOS: installs the update check (every 10 minutes) and nightly backup as launchd agents for the signed-in user.
# No sudo. They run while you are signed in, which Docker Desktop needs anyway.
#   bash deploy/launchd/install-agents.sh                 both
#   bash deploy/launchd/install-agents.sh --backup-only
#   bash deploy/launchd/install-agents.sh --remove
set -euo pipefail
[ "$(uname -s)" = "Darwin" ] || { echo "This is for macOS. On Linux use deploy/systemd." >&2; exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LABELS="com.pointwise.deploy com.pointwise.backup"
[ "${1:-}" = "--backup-only" ] && LABELS="com.pointwise.backup"
if [ "${1:-}" = "--remove" ]; then
  for l in com.pointwise.deploy com.pointwise.backup; do
    launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true; rm -f "$AGENTS/$l.plist"
  done
  echo "Removed."; exit 0
fi
mkdir -p "$AGENTS"
for l in $LABELS; do
  sed "s#@DIR@#$DIR#g" "$DIR/deploy/launchd/$l.plist" > "$AGENTS/$l.plist"
  plutil -lint "$AGENTS/$l.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$l.plist"
  echo "Installed $l"
done
launchctl list | grep pointwise || true
