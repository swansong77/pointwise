#!/usr/bin/env bash
# Installs the deploy and backup timers for the user who owns this checkout.
#   sudo bash deploy/systemd/install-timers.sh                 both timers
#   sudo bash deploy/systemd/install-timers.sh --backup-only   just the nightly off-schedule backup copy
#   sudo bash deploy/systemd/install-timers.sh --remove        take them out again
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Run with sudo." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OWNER="$(stat -c %U "$DIR")"
UNITS="pointwise-deploy pointwise-backup"
[ "${1:-}" = "--backup-only" ] && UNITS="pointwise-backup"
if [ "${1:-}" = "--remove" ]; then
  for u in pointwise-deploy pointwise-backup; do systemctl disable --now "$u.timer" 2>/dev/null || true; rm -f "/etc/systemd/system/$u.service" "/etc/systemd/system/$u.timer"; done
  systemctl daemon-reload; echo "Removed."; exit 0
fi
for u in $UNITS; do
  sed -e "s#@DIR@#$DIR#g" -e "s#@USER@#$OWNER#g" "$DIR/deploy/systemd/$u.service" > "/etc/systemd/system/$u.service"
  cp "$DIR/deploy/systemd/$u.timer" "/etc/systemd/system/$u.timer"
done
systemctl daemon-reload
for u in $UNITS; do systemctl enable --now "$u.timer"; done
systemctl list-timers 'pointwise-*' --no-pager
