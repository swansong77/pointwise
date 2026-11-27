#!/usr/bin/env bash
# Update a running PointWise to the latest code. Safe to run by hand, from cron, or from CI over SSH.
#
#   bash deploy/deploy.sh                 git pull, back up, build, restart, check, roll back if it does not come up
#   bash deploy/deploy.sh --registry      pull prebuilt images instead of building here (set PW_BACKEND_IMAGE and PW_FRONTEND_IMAGE)
#
# Options
#   --no-pull       do not git pull (deploy the code that is already here)
#   --registry      pull images from a registry instead of building on this server
#   --skip-backup   do not take a backup first (not recommended)
#   --if-changed    do nothing unless the git branch has new commits (for a timer that checks every few minutes)
#
# What it does, in order
#   1. takes a lock, so two deploys never run at once
#   2. makes an encrypted backup (when BACKUP_PASSPHRASE is set) and copies it to ./backups
#   3. remembers the images that are running now, so it can go back to them
#   4. gets the new code (git pull) and builds or pulls the images
#   5. restarts the stack; the API applies database migrations on start
#   6. waits for every service to be healthy and checks the web address
#   7. if anything fails, restarts the previous images and says how to restore the backup
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PULL=1 REGISTRY=0 BACKUP=1 IF_CHANGED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=0; shift ;;
    --registry) REGISTRY=1; PULL=0; shift ;;
    --skip-backup) BACKUP=0; shift ;;
    --if-changed) IF_CHANGED=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

exec > >(tee -a "$PW_ROOT/deploy.log") 2>&1
echo "──── deploy $(date -u '+%Y-%m-%d %H:%M:%S UTC') ────"

check_docker
[ -f "$PW_ENV_FILE" ] || die "No settings file at $PW_ENV_FILE. Run deploy/install.sh first."
pw_compose config -q || die "The settings are not valid."

LOCK="$PW_ROOT/.deploy.lock"
mkdir "$LOCK" 2>/dev/null || die "Another deploy is running (or one crashed: remove $LOCK if you are sure)."
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

if [ "$IF_CHANGED" = "1" ]; then
  [ -d "$PW_ROOT/.git" ] || die "--if-changed needs a git checkout."
  git -C "$PW_ROOT" rev-parse '@{u}' >/dev/null 2>&1 || die "This branch has no upstream to compare with (git branch --set-upstream-to=origin/main)."
  git -C "$PW_ROOT" fetch --quiet || die "git fetch failed (network, or no access to the repository)."
  if [ "$(git -C "$PW_ROOT" rev-parse HEAD)" = "$(git -C "$PW_ROOT" rev-parse '@{u}')" ]; then echo "No new commits; nothing to deploy."; exit 0; fi
  say "New commits found"
fi

# ── 2. backup ───────────────────────────────────────────────────────────────────
BACKUP_FILE=""
PASS="$(env_get BACKUP_PASSPHRASE)"
if [ "$BACKUP" = "1" ] && [ -n "$PASS" ] && [ -n "$(pw_compose ps -q backend 2>/dev/null || true)" ]; then
  say "Backing up before the update"
  if OUT="$(PW_PASSPHRASE="$PASS" pw_compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js backup 2>&1)"; then
    FILE="$(printf '%s' "$OUT" | sed -n 's/.*"file": "\(.*\)".*/\1/p')"
    if [ -n "$FILE" ]; then
      mkdir -p "$PW_ROOT/backups"
      pw_compose cp "backend:$FILE" "$PW_ROOT/backups/$(basename "$FILE")" && chmod 600 "$PW_ROOT/backups/$(basename "$FILE")"
      BACKUP_FILE="$PW_ROOT/backups/$(basename "$FILE")"
      ok "Backup saved: $BACKUP_FILE"
    fi
  else
    die "The backup failed, so nothing was changed: $OUT"
  fi
elif [ "$BACKUP" = "1" ]; then
  warn "No backup taken (no BACKUP_PASSPHRASE, or nothing is running yet)."
fi

# ── 3. remember what is running ─────────────────────────────────────────────────
ROLLBACK=0
for svc in backend frontend; do
  id="$(pw_compose ps -q "$svc" 2>/dev/null | head -n 1 || true)"
  if [ -n "$id" ]; then
    docker tag "$(docker inspect --format '{{.Image}}' "$id")" "pointwise/$svc:rollback" && ROLLBACK=1
  fi
done

# ── 4. new code ─────────────────────────────────────────────────────────────────
if [ "$PULL" = "1" ] && [ -d "$PW_ROOT/.git" ]; then
  say "Getting the latest code"
  git -C "$PW_ROOT" pull --ff-only || die "git pull could not fast-forward. Fix the local changes (git status) or use --no-pull."
fi
if [ "$REGISTRY" = "1" ]; then
  [ -n "${PW_BACKEND_IMAGE:-$(env_get PW_BACKEND_IMAGE)}" ] || die "--registry needs PW_BACKEND_IMAGE and PW_FRONTEND_IMAGE."
  say "Pulling images"
  pw_compose pull
else
  say "Building images (this can take several minutes)"
  pw_compose build
fi

rollback() {
  warn "The update did not come up healthy."
  if [ "$ROLLBACK" = "1" ]; then
    warn "Going back to the previous version."
    PW_BACKEND_IMAGE=pointwise/backend:rollback PW_FRONTEND_IMAGE=pointwise/frontend:rollback pw_compose up -d --remove-orphans || true
    wait_healthy backend 180 && wait_healthy frontend 120 && ok "The previous version is running again." || warn "The previous version did not start either. See: docker compose -f docker-compose.prod.yml logs"
  fi
  [ -n "$BACKUP_FILE" ] && warn "Database migrations may already have run. If the old version complains about the database, restore $BACKUP_FILE (docs/guides/03-automated-deployment.md, Rolling back)."
  exit 1
}

# ── 5/6. restart and check ──────────────────────────────────────────────────────
say "Restarting"
pw_compose up -d --remove-orphans || rollback
for svc in postgres redis; do wait_healthy "$svc" 120 || rollback; done
wait_healthy backend 300 || rollback
wait_healthy frontend 180 || rollback
wait_healthy caddy 60 || rollback

URL="$(env_get PW_PUBLIC_URL)"
if command -v curl >/dev/null 2>&1 && [ -n "$URL" ]; then
  if curl -fsSk --max-time 20 -o /dev/null "$URL/login"; then ok "$URL/login answers"; else warn "$URL/login did not answer from here (DNS, firewall or certificate still being issued?). The containers are healthy."; fi
fi

docker image prune -f >/dev/null 2>&1 || true
ok "Deployed. $(pw_compose ps --format '{{.Service}} {{.Status}}' | tr '\n' ';')"
