# ==============================================================================
# VPS Monitor — Multi-stage Dockerfile (monorepo)
#
# Builds all 3 packages: shared → api → web
# Used by docker-compose.yml for both API and Web services
#
# Build targets:
#   docker build --target api -t vps-monitor-api .
#   docker build --target web -t vps-monitor-web .
# ==============================================================================

# --- Stage 1: Install dependencies ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json    ./packages/api/
COPY packages/web/package.json    ./packages/web/

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false npm_config_maxsockets=3
RUN npm install --no-audit --no-fund

# --- Stage 2: Build shared library ---
FROM deps AS build-shared
COPY packages/shared/ ./packages/shared/
RUN npm run build:shared

# --- Stage 3: API server ---
FROM build-shared AS build-api
COPY packages/api/ ./packages/api/

FROM node:20-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/packages/shared ./packages/shared
COPY --from=build-api /app/packages/api ./packages/api
COPY --from=build-api /app/package.json ./

EXPOSE 4000
CMD ["npx", "tsx", "packages/api/src/index.ts"]

# --- Stage 4: Build web UI ---
FROM build-shared AS build-web
COPY packages/web/ ./packages/web/
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build:web

# --- Stage 5: Web runner ---
FROM node:20-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build-web /app/packages/web/public ./packages/web/public
COPY --from=build-web --chown=nextjs:nodejs /app/packages/web/.next/standalone ./
COPY --from=build-web --chown=nextjs:nodejs /app/packages/web/.next/static ./packages/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "packages/web/server.js"]
