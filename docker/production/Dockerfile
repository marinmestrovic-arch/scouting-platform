# ---------------------------------------------------------------------------
# Production multi-stage Dockerfile for @scouting-platform/web
#
# Uses Next.js standalone output for a minimal image (~150 MB vs ~1.5 GB dev).
# Stages: deps → build → runtime
# ---------------------------------------------------------------------------

# --- Stage 1: Install dependencies ---
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.6.1 --activate

WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/web/package.json ./frontend/web/
COPY backend/packages/core/package.json ./backend/packages/core/
COPY backend/packages/db/package.json ./backend/packages/db/
COPY backend/packages/integrations/package.json ./backend/packages/integrations/
COPY shared/packages/contracts/package.json ./shared/packages/contracts/
COPY shared/packages/config/package.json ./shared/packages/config/

RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# --- Stage 2: Build ---
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.6.1 --activate

WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/frontend/web/node_modules ./frontend/web/node_modules
COPY --from=deps /workspace/backend/packages/core/node_modules ./backend/packages/core/node_modules
COPY --from=deps /workspace/backend/packages/db/node_modules ./backend/packages/db/node_modules
COPY --from=deps /workspace/backend/packages/integrations/node_modules ./backend/packages/integrations/node_modules
COPY --from=deps /workspace/shared/packages/contracts/node_modules ./shared/packages/contracts/node_modules
COPY --from=deps /workspace/shared/packages/config/node_modules ./shared/packages/config/node_modules
COPY . .

# Generate Prisma client, then build the web app. Prisma only needs a
# syntactically valid datasource URL at build time.
RUN export DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public \
 && pnpm --filter @scouting-platform/db db:generate \
 && pnpm --filter @scouting-platform/web build

# Next.js standalone output does not retain the native argon2 package tree.
# Copy the minimal runtime closure explicitly for credential auth.
RUN mkdir -p /workspace/runtime-node-modules/node_modules/@phc \
 && cp -R /workspace/node_modules/.pnpm/argon2@*/node_modules/argon2 /workspace/runtime-node-modules/node_modules/argon2 \
 && cp -R /workspace/node_modules/.pnpm/node-gyp-build@*/node_modules/node-gyp-build /workspace/runtime-node-modules/node_modules/node-gyp-build \
 && cp -R /workspace/node_modules/.pnpm/node-addon-api@*/node_modules/node-addon-api /workspace/runtime-node-modules/node_modules/node-addon-api \
 && cp -R /workspace/node_modules/.pnpm/@phc+format@*/node_modules/@phc/format /workspace/runtime-node-modules/node_modules/@phc/format

# --- Stage 3: Production runtime ---
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

WORKDIR /app

# Copy standalone server and static assets produced by `next build`.
COPY --from=build --chown=nextjs:nodejs /workspace/frontend/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /workspace/frontend/web/.next/static ./frontend/web/.next/static
COPY --from=build --chown=nextjs:nodejs /workspace/frontend/web/public ./frontend/web/public
COPY --from=build --chown=nextjs:nodejs /workspace/runtime-node-modules/node_modules ./node_modules

USER nextjs
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# The standalone output places server.js at the package root.
CMD ["node", "frontend/web/server.js"]
