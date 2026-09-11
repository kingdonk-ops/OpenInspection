# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# patch-package runs during postinstall and needs the patches dir
COPY patches/ ./patches/
COPY package*.json ./
RUN npm ci

COPY . .
# gen-version.js reads git metadata; the build context includes .git/
RUN npm run build

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# Chromium is required for the BROWSER binding (PDF report + certificate rendering)
RUN apt-get update && apt-get install -y \
      chromium \
      fonts-noto-color-emoji \
      fonts-liberation \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Full node_modules is needed at runtime because wrangler is a dev-dependency
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build       ./build
COPY --from=builder /app/migrations  ./migrations
COPY --from=builder /app/scripts     ./scripts
COPY --from=builder /app/docker      ./docker
COPY --from=builder /app/wrangler.jsonc ./wrangler.jsonc
COPY --from=builder /app/package.json   ./package.json

# Tell puppeteer (used by wrangler's local BROWSER binding) where Chromium lives
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Persistent volume for local D1 SQLite, KV, R2 objects, and Durable Object state
VOLUME ["/data"]

EXPOSE 8787

RUN chmod +x /app/docker/entrypoint.sh

ENTRYPOINT ["/app/docker/entrypoint.sh"]
