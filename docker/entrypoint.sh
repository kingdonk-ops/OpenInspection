#!/usr/bin/env bash
set -euo pipefail

DATA_DIR=/data
PORT=${PORT:-8787}

# ── 1. Ensure the persistent volume is ready ────────────────────────────────
mkdir -p "$DATA_DIR"

# Symlink .wrangler/state → /data so that `wrangler d1 migrations apply --local`
# and `wrangler dev --persist-to /data` write to the same on-disk location.
mkdir -p /app/.wrangler
if [ ! -L /app/.wrangler/state ]; then
  ln -sfn "$DATA_DIR" /app/.wrangler/state
fi

# ── 2. Write .dev.vars from environment / auto-generated secrets ─────────────
node /app/docker/generate-dev-vars.js

# ── 3. Apply any pending D1 migrations ──────────────────────────────────────
echo "[entrypoint] Applying database migrations..."
node /app/scripts/wrangler.mjs d1 migrations apply DB --local

# ── 4. Start the worker ──────────────────────────────────────────────────────
echo "[entrypoint] Starting OpenInspection on 0.0.0.0:${PORT} ..."
exec npx wrangler dev \
  -c build/server/wrangler.json \
  --persist-to "$DATA_DIR" \
  --port "$PORT" \
  --ip 0.0.0.0
