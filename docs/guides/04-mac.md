# Guide 4: PointWise on a Mac

Two things you can do on a Mac, and this guide covers both:

- **Part A: develop on it.** Change the code and run the tests. (Guide 1 has the full detail; this part is the Mac-specific version.)
- **Part B: run it on it.** Use a Mac, such as a Mac mini or an always-on laptop, as the PointWise server for your household. Nothing to rent, nothing to pay.

Works on Apple Silicon and Intel Macs, macOS 13 or newer. The images are built natively for your chip, so the first build is a few minutes slower than a Linux server.

## Install the tools (once, for both parts)

1. **Docker.** Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (free for personal use and small businesses), open it once and accept the prompts. With Homebrew: `brew install --cask docker`. Wait until the whale icon in the menu bar stops animating.
2. **Command-line tools and Git.** Open Terminal and run `git --version`. If macOS offers to install the developer tools, accept.
3. **For Part A only: Node.js 22.** `brew install node@22` (or use `nvm`). Check `node --version` says v22.

Check:

```bash
docker run --rm hello-world       # "Hello from Docker!"
docker compose version            # v2.x
```

## Part A: develop on your Mac

Follow [Guide 1](01-local-development.md) exactly; every command works on macOS as written. The Mac-specific points:

| Topic | What to know |
|---|---|
| Which path | Path A (everything in Docker) needs only Docker. Path B (apps on your Mac, database in Docker) needs Node 22 too and gives hot reload. |
| Ports 3000, 4000, 5432, 6379 | If something else uses them (Postgres.app, a local Redis, another dev server) stop it, or Docker says "port is already allocated". Port 5000 and 7000 belong to AirPlay Receiver; PointWise does not use them. |
| Docker memory | Docker Desktop, Settings, Resources: give it at least 4 GB (6 GB to run the end-to-end suites) |
| File access | Keep the project on your Mac's disk or an external disk that Docker Desktop is allowed to read (Settings, Resources, File sharing; the default list includes `/Users` and `/Volumes`) |
| Line endings, shell | the scripts run with the Mac's own bash 3.2; nothing to install |

## Part B: run PointWise on your Mac for real

### B1. Decide how people reach it

| Who uses it | Address to choose |
|---|---|
| **Only you, on this Mac** | `http://localhost` |
| **Your household, on your home Wi-Fi** | the Mac's network name, `http://your-mac.local`, or its IP address, `http://192.168.1.20` |
| **You, from anywhere** | install the free [Tailscale](https://tailscale.com) app on the Mac and on your phone and laptop, then use the Mac's Tailscale address (or name) as the private address. Nothing is exposed to the internet. |
| **Everyone, over the internet with HTTPS** | possible (a domain pointing at your home, ports 80 and 443 forwarded on your router) but not advised for a Mac that sleeps and moves. Guide 2, choice A, describes it. |

Find the name and address:

```bash
echo "http://$(scutil --get LocalHostName).local"     # the Bonjour name
ipconfig getifaddr en0                                 # the Wi-Fi IP address (en1 or another number on some Macs)
```

`.local` names work on Apple devices and most Windows 10/11 PCs, but some Android phones do not resolve them. For a household, set a **DHCP reservation** in your router so the Mac keeps the same IP address, and use the IP address.

> **Who can create an account?** Anyone who can reach the address can sign up. On a home network that means anyone on your Wi-Fi. See Guide 2 for what that means and how to limit it.

### B2. Install

```bash
git clone <your repository address> ~/pointwise
cd ~/pointwise
bash deploy/install.sh --private-address http://192.168.1.20 --admin-email you@example.com
```

Use `http://localhost` for yourself only. If port 80 is taken (another web server on your Mac), add the port: `--private-address http://192.168.1.20:8080`.

The installer writes `.env` with new random secrets, builds and starts the containers (5 to 15 minutes the first time), and creates your administrator account with a one-time password. **Save the three things it prints** (the password, the `.env` file, the backup passphrase). Guide 2 explains each, and also first-time setup for members.

> The one-command `get.sh` from Guide 2 is for Linux servers. On a Mac use the steps above.

Open the address in a browser and sign in.

If macOS asks **"Do you want the application com.docker.backend to accept incoming network connections?"** choose Allow, otherwise other devices cannot reach it. If you missed it: System Settings, Network, Firewall, Options, and allow Docker.

### B3. Keep it running

A Mac server needs three settings, because by default a Mac sleeps and Docker stops with it.

1. **Start Docker when you sign in:** Docker Desktop, Settings, General, "Start Docker Desktop when you sign in to your computer". The containers restart themselves after Docker starts.
2. **Do not sleep:**
   - Desktop Mac (mini, iMac, Studio): System Settings, Energy, turn on "Prevent automatic sleeping when the display is off".
   - Laptop: keep it plugged in and run `sudo pmset -c sleep 0 disksleep 0`. A closed lid still sleeps a laptop unless an external display is attached, so a laptop is a poor server.
3. **Sign in automatically after a power cut or restart** (optional): System Settings, Users & Groups, Automatic login. It is unavailable with FileVault on, and it means anyone with physical access gets your session. If you leave it off, PointWise comes back after the next time you sign in.

Check after a restart: `docker compose -p pointwise-prod ps` shows every service Up.

### B4. Automatic updates and backups (optional)

Install two background jobs: a check for new code every 10 minutes (it only does work when there is something new), and a backup every night at 03:30. They run as you, with no sudo.

```bash
cd ~/pointwise
bash deploy/launchd/install-agents.sh
launchctl list | grep pointwise
tail -n 20 deploy-launchd.log            # what the last check did
```

Remove them with `bash deploy/launchd/install-agents.sh --remove`. Updates need Git access to the repository; for a private repository add a deploy key (Guide 3, A1). Everything in [Guide 3](03-automated-deployment.md) about backups, the restore test and rolling back applies unchanged. Use the same `deploy/*.sh` commands.

**Backups on a Mac.** Time Machine does not capture the data inside Docker, but it does capture `~/pointwise/backups/`, where `deploy/backup.sh` puts an encrypted copy every night. Keep that folder inside something Time Machine backs up, **and** copy it somewhere off the Mac (Guide 3, "Set up layer 3"). Keep `.env` and the backup passphrase in a password manager.

### B5. Everyday commands

| I want to… | Run (in `~/pointwise`) |
|---|---|
| see what is running | `docker compose -p pointwise-prod ps` |
| read logs | `docker compose -p pointwise-prod logs -f --tail 100 backend` |
| update now | `bash deploy/deploy.sh` |
| back up now | `bash deploy/backup.sh` |
| stop everything | `docker compose -p pointwise-prod stop` |
| start again | `docker compose -p pointwise-prod start` |
| add an administrator | `bash deploy/make-admin.sh someone@example.com` |

### When something goes wrong (Mac)

| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop is not running. Open it and wait for the whale to settle. |
| Others on the Wi-Fi cannot open it, but you can | the macOS firewall is blocking Docker (see B2), or the address in `.env` (`PW_PUBLIC_URL`) is not the one they type. Make them identical, then `bash deploy/deploy.sh --no-pull`. |
| It works for a while, then stops | the Mac slept. Fix B3, step 2. |
| `port is already allocated` on 80 | another web server uses it. Reinstall with `:8080` in the address, or stop the other one. |
| The build is very slow or is killed | give Docker more memory (Settings, Resources) and close big apps for the first build |
| `.local` name does not open on a phone | use the IP address, with a router reservation |

## Next

[Guide 2](02-self-host-install.md) for first-time setup for each member, and [Guide 3](03-automated-deployment.md) for updates, backups and recovery.
