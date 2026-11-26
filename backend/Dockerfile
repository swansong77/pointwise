# syntax=docker/dockerfile:1.7
# Pointwise API / worker image. Targets:
#   runtime (default) — production API & worker
#   test              — full toolchain for unit + integration tests

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx nest build

FROM build AS test
COPY jest.config.js ./
COPY test ./test
ENV NODE_ENV=test
# --maxWorkers=2: parallel ts-jest workers each load the AI SDKs; more workers get OOM-killed in the Docker VM
CMD ["sh", "-c", "npx jest --config jest.config.js --coverage --maxWorkers=2 && npx jest --config test/jest-integration.config.js --runInBand --coverage"]

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
