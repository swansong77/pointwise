# Guide 5: PointWise on a Windows PC

Two things you can do on Windows, and this guide covers both:

- **Part A: develop on it.** Change the code and run the tests.
- **Part B: run it on it.** Use a Windows PC (a desktop or mini PC that stays on) as the PointWise server for your household. Nothing to rent, nothing to pay.

## How it works on Windows

PointWise is a set of Linux containers and Linux shell scripts. On Windows you run them inside **WSL 2** (Windows Subsystem for Linux, built into Windows) with **Docker Desktop**. Everything in Guides 1 to 3 then works **as written, typed into the Ubuntu terminal**, not into PowerShell or Command Prompt.

```
Windows  ──►  Docker Desktop (WSL 2 engine)  ──►  your containers
   │
   └──►  Ubuntu (WSL)  ──►  the project folder, the deploy/ scripts, git, node
```

Needs: Windows 11, or Windows 10 version 22H2 or newer; 64-bit; virtualization turned on in the BIOS (most PCs have it on); 8 GB RAM (16 GB is comfortable) and 25 GB free disk.

## Install the tools (once, for both parts)

Open **PowerShell as administrator** (Start, type PowerShell, right-click, Run as administrator).

1. **WSL with Ubuntu:**

   ```powershell
   wsl --install -d Ubuntu
   ```

   Restart when asked. After the restart an Ubuntu window opens and asks you to choose a Linux username and password (remember them; they are not your Windows ones).

2. **Docker Desktop.** Install it from https://www.docker.com/products/docker-desktop/ (free for personal use and small businesses), keeping "Use WSL 2 instead of Hyper-V" ticked. Open it, accept the prompts, and wait until it says it is running.
3. **Connect Docker to Ubuntu:** Docker Desktop, Settings, Resources, WSL integration, switch on **Ubuntu**, Apply.

From now on, open **Ubuntu** from the Start menu for everything below. Check:

```bash
docker run --rm hello-world          # "Hello from Docker!"
docker compose version               # v2.x
```

> **Keep the project inside Ubuntu's own disk** (your home folder, `~/pointwise`), **not** under `/mnt/c/...` (your Windows drive). It is many times faster, and it avoids Windows file-permission and line-ending trouble. You can still open the files from Windows at `\\wsl$\Ubuntu\home\<your linux name>\pointwise`.

If a `.sh` script ever fails with `\r: command not found`, the files were checked out on the Windows side with Windows line endings. Clone again from inside Ubuntu, as below. (The project's `.gitattributes` also forces Unix endings for scripts.)

Give WSL a sensible memory limit so it does not take over the PC: create `C:\Users\<you>\.wslconfig` with

```
[wsl2]
memory=6GB
```

then run `wsl --shutdown` in PowerShell and reopen Ubuntu. (Use 4GB on an 8 GB PC.)

## Part A: develop on Windows

In Ubuntu:

```bash
sudo apt update && sudo apt install -y git curl
git clone <your repository address> ~/pointwise
cd ~/pointwise
```

Then follow [Guide 1](01-local-development.md) from step 2. For Path B (apps outside Docker with hot reload) install Node 22 in Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version                        # v22.x
```

What differs from Linux:

| Topic | What to know |
|---|---|
| Browser | open http://localhost:3000 in your normal Windows browser; WSL forwards localhost |
| Editor | VS Code with the "WSL" extension: in Ubuntu run `code .` inside `~/pointwise` |
| Ports 3000, 4000, 5432, 6379 in use | something on Windows holds it. In PowerShell: `netstat -ano \| findstr :3000` shows the process id; end it in Task Manager. |
| Slow first build | normal; run `docker compose up -d --build` once and wait |

## Part B: run PointWise on a Windows PC for real

### B1. Decide how people reach it

| Who uses it | Address |
|---|---|
| **Only you, on this PC** | `http://localhost` |
| **Your household, on your home Wi-Fi** | the PC's IP address, `http://192.168.1.20`. Set a **DHCP reservation** for the PC in your router so the address never changes. |
| **You, from anywhere** | install the free [Tailscale](https://tailscale.com) on the PC and on your phone and laptop, and use the PC's Tailscale address as the private address. Nothing is exposed to the internet. |
| **Everyone, over the internet with HTTPS** | possible, but a Windows PC that restarts for updates is a weak server for it. Guide 2, choice A, describes it. |

Find the PC's address in PowerShell: `ipconfig` and read the IPv4 Address of your Wi-Fi or Ethernet adapter.

> **Who can create an account?** Anyone who can reach the address can sign up. On a home network that means anyone on your Wi-Fi. See Guide 2.

### B2. Install

In Ubuntu:

```bash
git clone <your repository address> ~/pointwise     # skip if you already did in Part A
cd ~/pointwise
bash deploy/install.sh --private-address http://192.168.1.20 --admin-email you@example.com
```

Use `http://localhost` for yourself only. If port 80 is taken, add a port: `--private-address http://192.168.1.20:8080`. Windows often has **World Wide Web Publishing Service (IIS)** or another program on port 80: PowerShell, `netstat -ano | findstr :80`.

The installer builds and starts everything (5 to 20 minutes the first time) and creates your administrator with a one-time password. **Save what it prints**: the password, the `.env` file (it is in `\\wsl$\Ubuntu\home\<you>\pointwise\.env`), and the backup passphrase. Guide 2 explains each, and covers first-time setup for members.

> The one-command `get.sh` from Guide 2 is meant for Linux servers. On Windows use the steps above.

Open the address in a Windows browser and sign in.

### B3. Let other devices reach it

Docker Desktop makes the published ports available on the PC's network address. Windows Firewall must allow them. In **PowerShell as administrator**:

```powershell
New-NetFirewallRule -DisplayName "PointWise" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Profile Private
```

(Use `8080` instead of `80,443` if you chose that port.) `-Profile Private` limits it to networks you have marked Private. Check that your home Wi-Fi is: Settings, Network & internet, Wi-Fi, your network, "Private network". Then open `http://<the PC's address>` from a phone on the same Wi-Fi.

### B4. Keep it running

A Windows server needs these settings, because by default Windows sleeps, restarts for updates, and Docker waits for you to sign in.

1. **Start Docker with Windows:** Docker Desktop, Settings, General, "Start Docker Desktop when you sign in to your computer". The containers restart themselves once Docker is up.
2. **Never sleep when plugged in** (PowerShell):

   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```

3. **Sign in automatically after a restart** (optional, a trade-off: anyone with physical access gets your session): press Win+R, run `netplwiz`, untick "Users must enter a user name and password", and enter your password. Without it, PointWise returns the next time you sign in.
4. **Active hours:** Settings, Windows Update, Advanced options, Active hours, so updates do not restart the PC while you are using it.

Check after a restart: in Ubuntu, `docker compose -p pointwise-prod ps` shows every service Up.

### B5. Automatic updates and backups (optional)

Windows runs these through **Task Scheduler**, which starts Ubuntu for each run. In **PowerShell** (a normal window is enough; replace `Ubuntu` if your distribution has another name, see `wsl -l`):

```powershell
# check for new code every 10 minutes (does work only when something is new)
schtasks /Create /TN "PointWise deploy" /SC MINUTE /MO 10 /F /TR "wsl.exe -d Ubuntu -- bash -lc 'cd ~/pointwise && bash deploy/deploy.sh --if-changed >> deploy-task.log 2>&1'"

# backup every night at 03:30
schtasks /Create /TN "PointWise backup" /SC DAILY /ST 03:30 /F /TR "wsl.exe -d Ubuntu -- bash -lc 'cd ~/pointwise && bash deploy/backup.sh >> backup-task.log 2>&1 && { [ -x deploy/offsite.sh ] && deploy/offsite.sh || true; }'"
```

Look at them: `schtasks /Query /TN "PointWise deploy"`. Remove: `schtasks /Delete /TN "PointWise deploy" /F` (same for backup). Updates need Git access in Ubuntu: for a private repository add a deploy key (Guide 3, A1, typed in Ubuntu). Everything in [Guide 3](03-automated-deployment.md) about backups, the restore test and rolling back applies unchanged, typed in Ubuntu.

**Backups on Windows.** Backups are in `~/pointwise/backups/` inside Ubuntu (visible from Windows at `\\wsl$\Ubuntu\home\<you>\pointwise\backups`). Windows backup tools may not see that folder, so copy it to a Windows folder, a USB disk or a cloud drive with `deploy/offsite.sh` (Guide 3, "Set up layer 3"; a mounted Windows drive is `/mnt/d/...` from Ubuntu, so `rsync -a backups/ /mnt/d/pointwise-backups/` works). Keep `.env` and the backup passphrase in a password manager.

### B6. Everyday commands (type them in Ubuntu, in `~/pointwise`)

| I want to… | Run |
|---|---|
| see what is running | `docker compose -p pointwise-prod ps` |
| read logs | `docker compose -p pointwise-prod logs -f --tail 100 backend` |
| update now | `bash deploy/deploy.sh` |
| back up now | `bash deploy/backup.sh` |
| stop everything | `docker compose -p pointwise-prod stop` |
| start again | `docker compose -p pointwise-prod start` |
| add an administrator | `bash deploy/make-admin.sh someone@example.com` |

### When something goes wrong (Windows)

| Symptom | Fix |
|---|---|
| `docker: command not found` in Ubuntu | Docker Desktop is not running, or Ubuntu is not switched on under Settings, Resources, WSL integration |
| `Cannot connect to the Docker daemon` | start Docker Desktop and wait until it says running |
| `\r: command not found` | the scripts have Windows line endings. Clone again from inside Ubuntu into `~/pointwise`. |
| Opens on this PC but not on a phone | the firewall rule (B3), or the Wi-Fi is marked Public, or the address typed differs from `PW_PUBLIC_URL` in `.env` (make them identical, then `bash deploy/deploy.sh --no-pull`) |
| Port 80 already in use | IIS or another program. Stop it, or reinstall with `:8080` in the address. |
| Works, then stops overnight | the PC slept or restarted. Fix B4. |
| Very slow builds | the project is under `/mnt/c`. Move it to `~/pointwise`. |
| WSL uses all the memory | the `.wslconfig` limit above, then `wsl --shutdown` |

## Next

[Guide 2](02-self-host-install.md) for first-time setup for each member, and [Guide 3](03-automated-deployment.md) for updates, backups and recovery.
