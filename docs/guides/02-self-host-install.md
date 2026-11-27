# Guide 2: Install PointWise on your own server, and set it up for everyday use

This guide takes you from an empty server to a working PointWise that you and your household sign in to. It has two parts: **the installer** (whoever looks after the server) and **first-time setup for members** (everyone who will use it).

**Time:** about 30 minutes, most of it waiting for the first build. **Cost:** nothing beyond the server itself. PointWise needs no paid service, key or subscription to run.

## What you will end up with

- PointWise at an address such as `https://pointwise.example.com`, with HTTPS.
- One administrator account (you). No sample accounts, no published passwords.
- A real-card catalog loaded, an encrypted nightly backup, and automatic restarts after a reboot.
- Only ports 80 and 443 open. The database, Redis and the API are not reachable from outside.

## Before you start

### 1. A server

| | Minimum | Comfortable |
|---|---|---|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB (the first build is the heaviest part) |
| Disk | 20 GB | 40 GB (backups grow with use) |
| System | 64-bit Linux with Docker (Ubuntu 22.04 or 24.04, Debian 12 are what this guide uses) | |

Where it can live: a small cloud server, a spare computer or a mini PC at home, or a NAS that runs Docker. If it will hold your real card information, a machine you control at home is a perfectly good choice.

### 2. Decide how people will reach it

| Choice | Pick it when | What you need |
|---|---|---|
| **A. A public name with HTTPS** | you want to reach it from anywhere, on any device | a domain name (or a free sub-domain from a dynamic-DNS service) that points at the server, and ports 80 and 443 open to the internet |
| **B. A private address, home network only** | only people at home use it | the server's address on your network, such as `192.168.1.20`. No HTTPS, so sign-in details cross your home network unencrypted. Fine for a trusted home network, not for anything else. |
| **C. Private access from anywhere, through a VPN** | you want remote access without exposing the server | a free VPN such as Tailscale or WireGuard on the server and on each device. Use choice B's address (the VPN address). |

> **Who can create an account?** PointWise has open sign-up: anyone who can reach the address can register. With choice A the whole internet can. If this is for your household, prefer **B or C**, or keep A but only share the address with people you trust and check **Admin** for accounts you do not recognize. A public address is also what makes password reset and e-mail links work from outside, so A and C trade convenience against exposure.

### 3. Things to have ready

- The server's address and a way to sign in over SSH.
- Your e-mail address (you become the administrator).
- A place to keep secrets: a password manager. The installer prints a few values you must save.
- Optional: an outgoing mail account (see "Turn on e-mail" below). Without one, PointWise works but cannot send password-reset or digest e-mails.

## Part 1: Prepare the server

Sign in over SSH, then:

```bash
# 1. update
sudo apt update && sudo apt upgrade -y

# 2. install Docker (official script)
curl -fsSL https://get.docker.com | sudo sh

# 3. let your user run Docker, then sign out and back in
sudo usermod -aG docker "$USER"
exit
```

Sign in again and check:

```bash
docker run --rm hello-world       # prints "Hello from Docker!"
docker compose version            # v2.x
```

**Firewall.** Allow SSH, and the web ports only for choice A:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp             # choice A only (and B/C if they use these ports)
sudo ufw allow 443/tcp            # choice A only
sudo ufw enable
```

> Docker bypasses `ufw` for ports it publishes. That is safe here: the production stack publishes only Caddy's 80 and 443, nothing else.

**Choice A also needs DNS.** Create an `A` record (and `AAAA` if the server has IPv6) for your name that points at the server's public address. Check with `dig +short pointwise.example.com` that it answers with the server's address **before** you run the installer; the certificate is requested on first start, and a wrong record makes that fail.

## Part 2: Install

```bash
git clone <your repository address> pointwise
cd pointwise
```

Run the installer with the choice you made.

**Choice A, public name with HTTPS:**

```bash
bash deploy/install.sh --domain pointwise.example.com --admin-email you@example.com
```

**Choice B or C, private address:**

```bash
bash deploy/install.sh --private-address http://192.168.1.20 --admin-email you@example.com
```

If port 80 is already used on that machine, give a port: `--private-address http://192.168.1.20:8080`.

Leave out the options and the installer asks.

### What the installer does

1. Checks Docker and OpenSSL.
2. Writes `.env` (mode 600, never committed) with freshly generated random secrets: database password, session secrets, the key that encrypts stored logins, and the backup passphrase.
3. Builds the images and starts seven containers: database, Redis, API, background worker, scheduler, notification service, web app, plus Caddy for HTTPS. The first build takes **5 to 15 minutes**. The API applies the database migrations and loads the real-card catalog by itself.
4. Waits until each is healthy.
5. Creates your administrator account and prints a one-time password.

### Save what it prints

At the end you see:

- **Administrator e-mail and a generated password.** Shown once. Sign in, then change it (Settings).
- **`.env` location.** It holds every secret. Copy it into your password manager or an encrypted drive. If you lose `TOKEN_ENC_KEY`, stored bank, mailbox and offer logins become unreadable; if you lose `BACKUP_PASSPHRASE`, backups cannot be opened.
- **The backup passphrase.** Write it down separately from the server.

To pick your own administrator password instead, set it in the environment, not on the command line:

```bash
PW_ADMIN_PASSWORD='a long phrase with a number 7' bash deploy/install.sh --domain ...
```

(At least 10 characters, with a letter and a non-letter.)

### Check that it works

Open your address in a browser (`https://pointwise.example.com`). You should see the sign-in page. On the server:

```bash
docker compose -p pointwise-prod ps      # every service Up; backend, frontend, postgres, redis (healthy)
```

If something is wrong, jump to "When something goes wrong" below.

## Part 3: First sign-in as administrator

1. Sign in with the e-mail and password the installer printed.
2. **Settings**, then change the password to one in your password manager.
3. Open **Admin**. You see Operations, Card Data, AI & MCP, and Backup & Migration. Look at these once:
   - **Operations**: all checks green.
   - **Backup & Migration**: the server's checks pass, and a backup exists after the first night (or press Back up now).
4. Open **Admin, Backup & Migration** and make a backup right now with your passphrase. Download it and keep it somewhere that is not this server. **A backup you have not restored is a hope, not a backup**, so do the restore test in Guide 3 once.

Your administrator account is also an ordinary member account. Many people use it for themselves; others make a second account for daily use. Both are fine.

## Part 4: Add the other people

Give each person the address. They choose **Sign up**, then use a password of at least 10 characters with a letter and a non-letter. There is no invitation step. To make a second administrator:

```bash
bash deploy/make-admin.sh other@example.com
```

For **a spouse, children and authorized users in one household**, the person who owns the cards creates the household inside the app (below, step 6). They do not need separate accounts unless they want their own sign-in.

## Part 5: First-time setup for a member

This is what each person does once. About 10 minutes.

1. **Sign up or sign in.** You land on the Dashboard, empty at first.
2. **Settings, Profile.** Check your name. Your first name is used to greet you in briefings; it stays on the server (it is never part of what a cloud AI model could receive, see step 9).
3. **Add your cards.** Open **Wallet** and choose **Add a card**. Pick the card, add the date you opened it and its annual-fee date. The free plan holds 5 cards; see step 7 for more.
4. **Import what you already have.** Open **Import** and upload a spreadsheet or CSV (a statement export or your own tracker), or a PDF statement. Files are read on your server and the app shows what it found before saving anything. Do not upload anything you would not be willing to keep on this server.
5. **Look at Benefits.** Each card shows its credits, each with a date. Mark what you used; PointWise reminds you before each expires.
6. **Household (optional).** Open **Household**, add your spouse, children and authorized users, and say whose card is whose. This is what lets PointWise say "your spouse holds the best card for groceries" and work out the 5/24 position per person. Household needs the Pro plan.
7. **Plan.** Open **Settings, Subscription**. On your own server there is no charge: choosing **Pro** switches on unlimited cards and offers, household and offer alerts at no cost.
8. **Notifications.** In **Settings, Notifications** choose how you hear about things: in the app, by e-mail (needs mail set up, see below), or by browser notification. Turn on **Quiet Mode** if you want routine updates collected into one daily briefing, with only the critical ones sent at once.
9. **AI features (optional, off by default).**
   - **Copilot** (`/copilot`) plans and answers from your data. Switch **AI Mode** on in the command bar or Settings.
   - **Chief of Staff** (`/chief-of-staff`) ranks what needs doing, shows value at risk, a fee review and a 90-day roadmap. Switch it on in Settings.
   - Both work **without any cloud AI**: out of the box a built-in offline model answers, and everything is calculated on your server.
   - A cloud model (Anthropic, OpenAI or Gemini) is optional and needs the administrator to add a key. Even then, nothing leaves your server unless **you** give separate consent in Settings, and what is sent is a pseudonymized summary (no card numbers, names or amounts to the cent). Settings shows exactly what was sent.
10. **Spot-check.** Open **Dashboard** and **Offers**. You should see your cards, upcoming expirations and recommended next steps.

## Part 6: Everyday administration

| Task | How |
|---|---|
| Turn on e-mail | see below |
| Update PointWise | `bash deploy/deploy.sh` (or automate it, Guide 3) |
| Back up | automatic every night inside Docker; `bash deploy/backup.sh` copies one to `./backups`. Copy `./backups` off the server regularly. |
| Restore | `bash deploy/restore.sh backups/<file>` (Guide 3, "Restore test") |
| See what is running | `docker compose -p pointwise-prod ps` |
| Read logs | `docker compose -p pointwise-prod logs -f --tail 100 backend` (or `frontend`, `caddy`, `worker`) |
| Stop or start | `docker compose -p pointwise-prod stop` / `start` (it also restarts itself after a reboot) |
| Add an administrator | `bash deploy/make-admin.sh someone@example.com` |
| Move to a new server | `docs/migration-runbook.md` |
| Turn on a cloud AI model | add `ANTHROPIC_API_KEY=...` (or `OPENAI_API_KEY`, `GEMINI_API_KEY`) to `.env`, then `bash deploy/deploy.sh --no-pull`. These are paid by you to the provider and optional. |

### Turn on e-mail

E-mail is used for password reset and digests. Any SMTP provider works, including the free tiers of Brevo, Mailgun and Amazon SES, your own mail host, or Gmail with an app password. Edit `.env`:

```
MAIL_DISABLED=false
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASSWORD=your-password
SMTP_SECURE=false          # true only for port 465
MAIL_FROM="PointWise <pointwise@your-domain.example>"
```

Then apply it with `bash deploy/deploy.sh --no-pull`. Test with **Forgot password** on the sign-in page.

### Keep it safe

- Keep the server's system updated (`sudo apt update && sudo apt upgrade`), and turn on unattended security updates.
- Use SSH keys and turn off SSH password sign-in.
- Do not open any port except 80 and 443 (or none for choice C).
- The `.env` file and `backups/` folder are private. They are in `.gitignore`; keep it that way.
- Never turn the sample accounts back on: nothing in this stack creates them.

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| The installer says Docker is not usable | you did not sign out and back in after `usermod`; do that |
| The installer stops at "API did not become healthy" | `docker compose -p pointwise-prod logs --tail 80 backend`. Usually a wrong value in `.env`. |
| The certificate is not issued (browser warning, or `ERR_SSL`) | DNS does not yet point at this server, or 80/443 are blocked. Fix it, then `docker compose -p pointwise-prod restart caddy`; watch with `logs caddy`. |
| Sign-in loops or "invalid callback" | `PW_PUBLIC_URL` in `.env` differs from the address in the browser (http versus https, a missing `www.`). Make them identical, then `bash deploy/deploy.sh --no-pull`. |
| "Network error" after sign-in | the API is down: `docker compose -p pointwise-prod ps backend` |
| Port 80 or 443 already in use | set `PW_HTTP_PORT` and `PW_HTTPS_PORT` in `.env` (with choice A, free the ports instead: HTTPS needs them) |
| No e-mail arrives | check the SMTP values and `MAIL_DISABLED=false`; `logs backend` shows `mail to ... failed` with the reason |
| You forgot the administrator password | `bash deploy/make-admin.sh you@example.com` does not reset passwords. Use **Forgot password** (needs e-mail), or ask another administrator. |
| You want to start over | `docker compose -p pointwise-prod down -v` deletes **all data**, then delete `.env` and run the installer again |

## Next

[Guide 3](03-automated-deployment.md) updates the server by itself, takes off-site backups, and shows how to roll back.
