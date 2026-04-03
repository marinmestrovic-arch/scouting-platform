# ---------------------------------------------------------------------------
# Production Dockerfile for @scouting-platform/worker on Dokku
#
# Unlike the web image, the worker keeps the full workspace and dev
# dependencies so it can:
# - run directly from source via `node --import tsx`
# - reuse Prisma CLI for one-off migration commands via `dokku run`
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV HUSKY=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.6.1 --activate

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production

CMD ["node", "--import", "tsx", "backend/worker/src/index.ts"]
