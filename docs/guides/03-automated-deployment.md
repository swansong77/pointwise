# Guide 3: Automate deployment to your own server

Guide 2 installed PointWise. This guide makes **updates, backups and recovery happen without you remembering to do them**, and tells you how to undo an update that goes wrong.

You will pick one way of updating, then add backups, a restore test and a little monitoring.

## How an update works

Every update, whichever way it starts, runs the same script, `deploy/deploy.sh`:

```
1. take a lock                    two updates never run at once
2. encrypted backup               copied to ./backups  (a failed backup stops the update; nothing is changed)
3. remember the running images    so they can be put back
4. get the new code               git pull  (or pull ready-made images with --registry)
5. build or pull the images
6. restart                        the API applies database migrations as it starts
7. wait until every service is healthy and the web address answers
8. if anything fails              put the old images back, say where the backup is, exit with an error
```

Everything is appended to `deploy.log` in the project folder.

**What rollback does and does not cover.** It puts the previous program back. It does not undo database migrations that already ran. No migration in this project so far has dropped a table or column, so the previous program normally runs on the newer database. Check the new migrations in the update (`backend/prisma/migrations`) if you want to be sure. If the old program does not run, restore the backup the update took first (see "Rolling back" below).

## Choose how updates start

| | A. The server checks by itself | B. Your code host pushes the update |
|---|---|---|
| How | a timer on the server runs `deploy.sh --if-changed` every 10 minutes | GitHub Actions tests, builds images and tells the server to deploy |
| Server needs | git access to the repository | an SSH key for the build service |
| Build happens | on the server (slower, uses its CPU) | on GitHub (the server only pulls) |
| Tests before deploy | no | yes: a red test stops the deploy |
| Best for | one server, one person, simplest | you want tests as a gate, or the server is small |
| Cost | none | free for private repositories within GitHub's monthly minutes, free for public ones |

You can start with A and move to B later; they use the same script.

---

## Option A: the server checks for new code (systemd timer)

### A1. Let the server read the repository

The checkout from Guide 2 must be able to run `git pull` without asking for a password.

- **Public repository:** nothing to do.
- **Private repository:** make a read-only key and add it as a *deploy key* in the repository's settings.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pointwise_deploy -N ""
cat ~/.ssh/pointwise_deploy.pub            # paste into GitHub: repository, Settings, Deploy keys (read-only)
git -C ~/pointwise remote set-url origin git@github.com:YOU/pointwise.git
GIT_SSH_COMMAND="ssh -i ~/.ssh/pointwise_deploy" git -C ~/pointwise fetch     # must succeed with no prompt
git -C ~/pointwise config core.sshCommand "ssh -i ~/.ssh/pointwise_deploy"
```

Check the branch tracks the remote: `git -C ~/pointwise status -sb` shows `main...origin/main`. If not: `git branch --set-upstream-to=origin/main`.

### A2. Try it by hand

```bash
cd ~/pointwise
bash deploy/deploy.sh --if-changed
```

With nothing new it prints `No new commits; nothing to deploy.` and stops. To see a real run, use `bash deploy/deploy.sh`.

### A3. Install the timers

```bash
sudo bash deploy/systemd/install-timers.sh
systemctl list-timers 'pointwise-*'
```

This installs two timers: **deploy** (every 10 minutes, only does work when there are new commits) and **backup** (every night at 03:30, copies a fresh encrypted backup into `./backups`).

Watch it work:

```bash
journalctl -u pointwise-deploy.service -n 50 --no-pager
tail -n 50 ~/pointwise/deploy.log
```

To remove them: `sudo bash deploy/systemd/install-timers.sh --remove`.

### A4. Decide what "new code" means

The timer deploys whatever lands on the branch the checkout follows. To keep a gate between your work and the server, develop on other branches and merge to `main` only when it is ready. If you would rather approve each update by hand, skip the timer and run `bash deploy/deploy.sh` yourself.

---

## Option B: GitHub Actions deploys after tests pass

The ready-to-copy workflow is `deploy/examples/github-actions-deploy.yml`. It is not active until you copy it.

### B1. Make a key only for deploying

On your own computer:

```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
ssh-copy-id -i deploy_key.pub YOU@your-server        # or append deploy_key.pub to ~/.ssh/authorized_keys on the server
ssh-keyscan -t ed25519 your-server                   # keep this output for the next step
```

Anyone holding `deploy_key` can sign in as that user, so use it for this purpose only, store it only as a GitHub secret, and delete the local copy when done.

### B2. Add the secrets

In the repository: **Settings, Secrets and variables, Actions, New repository secret**.

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server's name or address |
| `DEPLOY_USER` | the user that owns the checkout (not root) |
| `DEPLOY_SSH_KEY` | the contents of `deploy_key` |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output |
| `DEPLOY_PATH` | e.g. `/home/you/pointwise` |
| `GHCR_PULL_TOKEN` | private repositories only: a token with `read:packages` so the server may pull the images |

### B3. Turn it on

```bash
mkdir -p .github/workflows
cp deploy/examples/github-actions-deploy.yml .github/workflows/deploy.yml
git add .github/workflows/deploy.yml && git commit -m "Deploy on push to main" && git push
```

Open the repository's **Actions** tab. A push to `main` now runs: tests, then builds and publishes the two images (tagged with the commit), then signs in to the server and runs `deploy.sh --registry` with those images.

Optional: add a required reviewer under **Settings, Environments, production** to make every deploy wait for your click.

### B4. Remember what it does to the server's checkout

The workflow runs `git reset --hard origin/main` there, so keep your own edits to tracked files out of the server checkout. `.env`, `backups/` and `deploy.log` are not tracked and are safe.

---

## Backups you can rely on

There are three layers. Use all of them.

| Layer | What | Where it lives |
|---|---|---|
| 1. Nightly, inside Docker | the app makes an encrypted backup every night when `BACKUP_PASSPHRASE` is set; the newest `BACKUP_KEEP` (14) are kept | the `pointwise-prod_pointwise-backups` volume, on this server |
| 2. Copies in `./backups` | `deploy.sh` (before each update) and `deploy/backup.sh` (the timer, nightly) copy a file out of Docker | the project folder, on this server |
| 3. Off the server | `deploy/offsite.sh` copies `./backups` somewhere else after every backup | another machine, a cloud drive or a disk |

**Layers 1 and 2 die with the server.** Layer 3 is the one that saves you from a failed disk, a deleted server or a ransomware incident.

Set up layer 3:

```bash
cp deploy/examples/offsite.sh.example deploy/offsite.sh
nano deploy/offsite.sh            # uncomment ONE of rsync-over-SSH, rclone, or a mounted disk
chmod +x deploy/offsite.sh
bash deploy/offsite.sh            # run it once by hand and confirm the files arrive
```

The timer runs it after every backup. Backups are encrypted with your passphrase, so a copy on a service you do not fully trust is still unreadable to it.

Also keep, off the server and apart from the backups: **`.env`** (it holds `TOKEN_ENC_KEY` and the secrets) and **the backup passphrase**. Without them a backup cannot be used.

### The restore test (do this once, and after major updates)

A backup you have never restored is a hope. Prove it works **without touching real data**, using a second, throwaway copy of the stack:

```bash
cd ~/pointwise
# 1. a latest backup
bash deploy/backup.sh

# 2. a scratch install on other ports, with its own database and its own settings file
export COMPOSE_PROJECT_NAME=pwscratch PW_ENV_FILE=/tmp/scratch.env
cp .env /tmp/scratch.env
sed -i 's#^PW_SITE_ADDRESS=.*#PW_SITE_ADDRESS=http://localhost#; s#^PW_PUBLIC_URL=.*#PW_PUBLIC_URL=http://localhost:18080#; s#^PW_HTTP_PORT=.*#PW_HTTP_PORT=18080#; s#^PW_HTTPS_PORT=.*#PW_HTTPS_PORT=18443#' /tmp/scratch.env
docker compose --env-file /tmp/scratch.env -f docker-compose.prod.yml -p pwscratch up -d --build
. deploy/lib.sh && wait_healthy backend 300

# 3. restore the real backup into the scratch copy
PW_YES=1 bash deploy/restore.sh "$(ls -t backups/*.pwbackup | head -1)"

# 4. look at it: sign in at http://localhost:18080 (from the server, or through an SSH tunnel: ssh -L 18080:localhost:18080 you@server)

# 5. throw the scratch copy away
docker compose --env-file /tmp/scratch.env -f docker-compose.prod.yml -p pwscratch down -v
rm /tmp/scratch.env; unset COMPOSE_PROJECT_NAME PW_ENV_FILE
```

The restore prints `OK` for every check ("every reference points at a row", "secrets decrypt with this key", "an administrator exists") and ends with `verified`. If a check fails, that backup is not good. Find out why now, not during an emergency.

## Rolling back

### The update did not come up

`deploy.sh` has already put the previous images back and told you. Check:

```bash
docker compose -p pointwise-prod ps
tail -n 80 deploy.log
```

Read what failed (`docker compose -p pointwise-prod logs --tail 80 backend`), fix it in the code, and deploy again.

### The update came up, but it is wrong

Go back to the previous commit and deploy that:

```bash
cd ~/pointwise
git log --oneline -5                      # find the last good commit
git reset --hard <good commit>            # (option B: revert on main instead, so the pipeline redeploys)
bash deploy/deploy.sh --no-pull
```

With option A the timer would redeploy the newer commit on its next check; to hold back, run `sudo systemctl stop pointwise-deploy.timer` until you are ready (`start` to resume), or `git revert` the bad commit on the branch.

### The old version refuses to start on the new database

This is rare. Restore the backup the update took before it ran (its path is in the failure message and in `deploy.log`):

```bash
bash deploy/restore.sh backups/pointwise-<timestamp>.pwbackup
```

Anything members entered after the update started is lost; the restore also makes its own safety backup first.

### Disaster: the server is gone

1. Build a new server (Guide 2, Part 1) and clone the repository.
2. Put your saved `.env` in the project folder (`chmod 600 .env`). Do **not** generate a new one: the same `TOKEN_ENC_KEY` and `JWT_*` values keep stored logins readable and members signed in.
3. `bash deploy/deploy.sh --no-pull --skip-backup` (builds and starts an empty stack).
4. Copy the latest backup from your off-site copy into `backups/` and run `bash deploy/restore.sh backups/<file>`.
5. Point the DNS name at the new server (`docs/migration-runbook.md` lists everything that depends on the address).

## Keeping an eye on it

**Is it up?** Use a free uptime checker (UptimeRobot, Healthchecks.io, or a script on another machine) to request `https://your-address/login` every few minutes and e-mail you on failure.

**Is the deploy timer healthy?** Check `systemctl status pointwise-deploy.service` and `journalctl -u pointwise-deploy.service -n 20`. A line `fail` or `warn` there or in `deploy.log` needs a look.

**Is it running out of room?** Each deploy leaves old images, and backups accumulate.

```bash
df -h /                         # disk use
docker system df                # what Docker holds
docker image prune -a -f        # remove images no container uses (safe; the next build re-creates what it needs)
ls -lh ~/pointwise/backups | tail    # BACKUP_KEEP controls how many stay
```

**Operating system updates.** Turn on unattended security updates (Ubuntu and Debian: `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`). Reboot after kernel updates; the stack restarts itself.

**Certificates.** Caddy renews them itself. If HTTPS ever shows a warning, `docker compose -p pointwise-prod logs caddy` says why (usually DNS or a blocked port 80).

## Quick reference

| I want to… | Run |
|---|---|
| deploy now | `bash deploy/deploy.sh` |
| deploy without pulling new code (after editing `.env`) | `bash deploy/deploy.sh --no-pull` |
| deploy only if there is something new | `bash deploy/deploy.sh --if-changed` |
| deploy ready-made images | `PW_BACKEND_IMAGE=… PW_FRONTEND_IMAGE=… bash deploy/deploy.sh --registry` |
| back up now | `bash deploy/backup.sh` |
| restore | `bash deploy/restore.sh backups/<file>` |
| add an administrator | `bash deploy/make-admin.sh someone@example.com` |
| see services | `docker compose -p pointwise-prod ps` |
| read logs | `docker compose -p pointwise-prod logs -f --tail 100 backend` |
| pause automatic updates | `sudo systemctl stop pointwise-deploy.timer` |
| see what the last deploy did | `tail -n 80 deploy.log` |
