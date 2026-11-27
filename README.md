<p align="center"><img src="frontend/public/logo/pointwise-logo.svg" alt="PointWise" width="280" /></p>

claude rc# project-analysis — CardPointers analysis & PointWise web app

Start with **[final-report/final-report.md](final-report/final-report.md)**. Progress log: [docs/progress.md](docs/progress.md).

```
project-analysis/
├── docs/            Phase docs 1–25 (analysis, PRD, specs, reviews, validation)
├── diagrams/        30 Mermaid sources extracted from docs
├── api/             openapi.json (PointWise) · cardpointers-observed.openapi.json (reverse-engineered)
├── database/        schema.prisma (canonical)
├── backend/         NestJS API + worker (Prisma, BullMQ) — Dockerfile, tests
├── frontend/        Next.js 15 app (NextAuth, TanStack Query, Tailwind) — Dockerfile, tests
├── tests/           test-cases/ catalog (134 cases, CSV) + generator
├── playwright/      E2E suite (+ axe accessibility) — Dockerfile
├── cypress/         E2E suite — Dockerfile
├── docker/          postgres init, pgAdmin servers
├── screenshots/     written by Playwright runs
├── raw/             reverse-engineering evidence (strings, symbols, models)
└── final-report/
```

## Step-by-step guides

| Guide | For |
|---|---|
| [1. Local development](docs/guides/01-local-development.md) | changing the code, running the tests |
| [2. Install on your own server](docs/guides/02-self-host-install.md) | a real install with HTTPS, your first administrator, and first-time setup for each member |
| [3. Automated deployment](docs/guides/03-automated-deployment.md) | updates, backups, rollback and recovery without doing it by hand |

The stock `docker-compose.yml` is for development only (sample accounts with public passwords, every port open). A real install uses `docker-compose.prod.yml` through `deploy/install.sh`.

## Quick start (Docker)

```bash
cp .env.example .env        # change secrets for anything non-local
docker compose up -d --build
# Web http://localhost:3000 · API docs http://localhost:4000/api/docs
# MailHog http://localhost:8025 · pgAdmin http://localhost:5050
# Demo user: demo@pointwise.local / Demo12345!  ·  Admin: admin@pointwise.local / Admin12345!
docker compose --profile test run --rm backend-tests
docker compose --profile e2e run --rm e2e
docker compose --profile cypress run --rm cypress
```

## Local development (without Docker for the apps)

```bash
docker compose up -d postgres redis mailhog
cd backend && cp .env.example .env && npm ci && npx prisma migrate deploy && npm run build && npm run seed && npm run start:dev
cd frontend && cp .env.example .env.local && npm ci && npm run dev
```

Tests: `backend: npm run test:cov` · `backend: DATABASE_URL=…/pointwise_test npm run test:integration` · `frontend: npm run test:cov`.

## Notes

- The demo catalog (issuers, cards, merchants) is **fictional**. No CardPointers data, assets, branding or APIs are used by the web app.
- Money is integer cents everywhere. Card numbers are never stored (last 4 digits only).
