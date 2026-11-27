# Guide 1: Local development

Run PointWise on your own computer to change the code, try a feature or run the tests. This is not the guide for running PointWise for real use: that is [Guide 2](02-self-host-install.md).

**Time:** about 15 minutes the first time. **Result:** the web app at http://localhost:3000, the API at http://localhost:4000, sample data to look at, and the test suites passing.

## What you need

| Tool | Version | Check with |
|---|---|---|
| Docker Desktop (or Docker Engine) with Compose v2 | any recent | `docker compose version` |
| Node.js | 22 LTS (the Docker images use 22) | `node --version` |
| Git | any | `git --version` |

About 6 GB of free disk space and 8 GB of RAM are comfortable.

## Pick a path

- **Path A, everything in Docker** (steps 1 to 3). Nothing to install except Docker. Code changes need a rebuild. Best for trying PointWise or running the full end-to-end tests.
- **Path B, apps on your machine, database in Docker** (steps 1 and 4 to 7). Edits show up immediately (hot reload). Best for day-to-day development.

You can use both: Path A's database containers are the ones Path B uses.

## 1. Get the code

```bash
git clone <your repository address> pointwise
cd pointwise
```

The folders you will meet: `backend/` (NestJS API and background jobs), `frontend/` (Next.js web app), `database/` and `backend/prisma/` (data model and migrations), `docker/` (helper scripts), `docs/`, `playwright/` and `cypress/` (end-to-end tests), `deploy/` (production, see Guide 2).

## 2. Path A: start everything in Docker

```bash
docker compose up -d --build
docker compose ps          # wait until backend and frontend say (healthy); the first build takes several minutes
```

Open http://localhost:3000.

## 3. Sign in with the sample accounts

The stack fills itself with a made-up card catalog and sample members. These accounts exist **only on a development stack**, because their passwords are public:

| Account | Password | What it is |
|---|---|---|
| `demo@pointwise.local` | `Demo12345!` | a member with cards, benefits and offers |
| `family@pointwise.local` | `Family12345!` | a household with a spouse and children (Pro plan) |
| `admin@pointwise.local` | `Admin12345!` | an administrator |

Other things running on your computer while the stack is up:

| Address | What |
|---|---|
| http://localhost:3000 | the web app |
| http://localhost:4000/api/docs | the API reference (Swagger) |
| http://localhost:8025 | MailHog: every e-mail the app sends lands here, none leave your computer (try Forgot password) |
| http://localhost:5050 | pgAdmin, to look into the database |

Stop with `docker compose down`. Add `-v` to also delete the database and start from scratch.

If you only wanted to look around, you are done. Everything below is for changing code.

## 4. Path B: start only the services the apps need

```bash
docker compose up -d postgres redis mailhog
docker compose ps postgres redis mailhog      # all healthy
```

If you started the whole stack in step 2, stop the apps first so they do not take the ports: `docker compose stop frontend backend worker scheduler notification-service`.

## 5. Run the API

```bash
cd backend
cp .env.example .env          # already points at localhost:5432, :6379 and :1025
npm ci
npx prisma generate
npx prisma migrate deploy     # creates the tables
npm run build
npm run seed                  # sample catalog and the accounts above
npm run start:dev             # API on http://localhost:4000, restarts when you save a file
```

Check it: `curl http://localhost:4000/health` answers `{"status":"ok","db":"up",...}`.

Scheduled and queued work (offer scans, digests, briefings) runs in separate processes. You only need them when you are working on a job. In another terminal, from `backend/`:

```bash
npm run start:worker           # runs queued jobs
node dist/scheduler.js         # registers the cron schedule
```

Or run one job by hand, as an administrator, with `POST /api/v1/admin/jobs/<name>/run` (see the Swagger page).

### Which data to seed

`SEED_CATALOG` chooses what `npm run seed` creates:

| Value | You get |
|---|---|
| `demo` (default) | made-up cards and issuers, plus the sample members. What the tests expect. |
| `real` | the curated real-card list only, plus an empty admin and demo account |
| `both` | sample members plus the real-card list |

Set `SEED_DEMO_USERS=false` to create no members. The seed is safe to run again.

## 6. Run the web app

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev                    # http://localhost:3000, hot reload
```

The web app forwards `/api/v1/*` to the API at `API_INTERNAL_URL` (default `http://localhost:4000`), so the browser only ever talks to port 3000.

## 7. Change something and check it

A typical loop:

1. Edit code. The API and the web app reload by themselves.
2. Type-check: `npm run lint` (in `backend/` or `frontend/`; it runs `tsc --noEmit`).
3. Run the tests for what you touched (next section).
4. Look at it in the browser.

### Changing the database

1. Edit `backend/prisma/schema.prisma`.
2. Create a migration folder under `backend/prisma/migrations/` named `<UTC timestamp>_<what_changed>` containing a `migration.sql`. Use the newest existing folder as a model, and put the timestamp after the last one.
3. `npx prisma migrate deploy` then `npx prisma generate`.
4. If members' data lives in the new table, register it in `backend/src/domain/data-registry.ts` so export, backup and account deletion include it. A test fails if you forget.

> **Do not run `npm run prisma:sync`.** It copies `database/schema.prisma` over `backend/prisma/schema.prisma`, and that older copy is behind. The backend's copy is the one in use.

## Tests

| What | Command (from the folder) | Needs |
|---|---|---|
| Backend unit tests | `cd backend && npm test` (coverage: `npm run test:cov`) | nothing else |
| Backend integration tests | `cd backend && DATABASE_URL=postgresql://pointwise:pointwise@localhost:5432/pointwise_test npm run test:integration` | Postgres and Redis up, and an empty `pointwise_test` database (below) |
| Web app tests | `cd frontend && npm test` | nothing else |
| End-to-end, Playwright | `docker compose --profile e2e run --rm e2e` | the whole stack up |
| End-to-end, Cypress | `docker compose --profile cypress run --rm cypress` | the whole stack up |

Create the integration-test database once:

```bash
docker compose exec postgres createdb -U pointwise pointwise_test
```

Or run the backend tests entirely inside Docker, without installing Node: `docker compose --profile test run --rm backend-tests`.

> **Run end-to-end tests against a throwaway database, not the one you use.** They sign up test members and change data. `docker/validate-portfolio.sh` shows how: it sets `POINTWISE_DB=pointwise_e2e` so the stack uses its own database while the suite runs, then puts the stack back. If you keep real data in your development database, copy that approach.

Test files sit next to what they test: `backend/test/unit`, `backend/test/integration`, `frontend/src/**/*.test.tsx`, `playwright/tests`, `cypress/cypress/e2e`.

## When something goes wrong

| Symptom | Fix |
|---|---|
| `port is already allocated` (3000, 4000, 5432, 6379) | something else uses it. Stop it, or `docker compose stop` the service you are about to run on your machine. |
| `Can't reach database server at localhost:5432` | `docker compose up -d postgres` and wait for healthy |
| `Environment variable not found: DATABASE_URL` | you are not in `backend/`, or `.env` is missing: `cp .env.example .env` |
| the web app shows network errors | the API is not running on 4000. Check `curl localhost:4000/health`. |
| `Type '…' is not assignable` after pulling new code | `npx prisma generate` in `backend/` (the data model changed) |
| the data model changed and the API refuses to start | `npx prisma migrate deploy` |
| emails do not arrive | they go to MailHog at http://localhost:8025, never to real inboxes |
| you want a clean slate | `docker compose down -v`, then start again from step 2 or 4 |

## Rules for this project

These apply to code and to anything you commit:

- **No real personal data in the repository.** Never commit statements, workbooks, database dumps, logs or real card numbers, e-mail addresses or names. `.gitignore` covers the usual places; look at `git status` before every commit.
- **Free solutions only.** Do not add a paid API, aggregator or hosting dependency. A paid option may be written down in `docs/`, never wired in.
- **No automation against bank or card-issuer sites.** No logins, scraping or bots. Assisted activation, where the member does the clicking, is the pattern.
- **Card data stays local.** Raw card data never goes to an AI provider. Only the opt-in, pseudonymized view described in `docs/architecture-decisions.md` (ADR-004a) may.

## Next

[Guide 2](02-self-host-install.md) puts PointWise on a server. [Guide 3](03-automated-deployment.md) makes updating it automatic.
