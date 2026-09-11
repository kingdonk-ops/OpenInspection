# Deploying to Coolify

This guide covers running OpenInspection on a self-hosted [Coolify](https://coolify.io)
instance — or any other Docker-based platform — **without a Cloudflare account**.

The app runs inside a container using Cloudflare's open-source
[`workerd`](https://github.com/cloudflare/workerd) runtime (bundled inside
`wrangler dev`), which simulates the Cloudflare Workers environment locally:
D1 becomes a local SQLite database, R2 becomes local object storage, KV
becomes a local key-value store, and Durable Objects run in-process.

---

## What works / what does not

| Feature | Status |
|---|---|
| Inspections, templates, reports, e-sign, agreements, invoicing | Full |
| PDF report + certificate rendering (BROWSER binding) | Full — Chromium is bundled in the image |
| Collaborative inspection editing (Durable Objects) | Full |
| Background jobs / cron sweep (Queues) | Full |
| Email (Resend) | Full when `RESEND_API_KEY` is set |
| QuickBooks sync | Full when `QBO_*` vars are set |
| Google Calendar sync | Full when `GOOGLE_CLIENT_*` vars are set |
| AI-assisted writing | Full when `AI_BASE_URL` + `AI_MODEL` are set (or configured per workspace) |
| Turnstile bot protection | Full when `TURNSTILE_SECRET_KEY` is set |
| Word (.docx) export photo downscaling (IMAGES binding) | Falls back gracefully — photos are embedded at original size |
| Cloudflare Stream video | Not available — video storage uses R2 (local filesystem) |

---

## Prerequisites

- A running Coolify instance (self-hosted or cloud)
- The repository accessible to Coolify (GitHub App or public URL)
- At least 1 CPU + 512 MB RAM for the container; 1 GB+ recommended

---

## Quick setup in Coolify

### 1. Create the resource

In Coolify, click **+ New Resource** and choose one of:

- **Dockerfile** — point at this repo; Coolify builds and runs the `Dockerfile` at the root.
- **Docker Compose** — point at this repo; Coolify uses `docker-compose.yml`.

Set the branch to whatever you deploy from (e.g. `main`).

### 2. Configure the domain

In Coolify's resource settings, set the domain (e.g. `https://inspect.yourdomain.com`)
and confirm the port is **8787**.

### 3. Set environment variables

In Coolify's **Environment Variables** tab, set at minimum:

| Variable | Value |
|---|---|
| `APP_BASE_URL` | The public URL Coolify routes to, e.g. `https://inspect.yourdomain.com`. Must match exactly — OAuth redirects and email links use it. |
| `SETUP_CODE` | Any string of at least 6 characters. Gates `/setup`. |

The JWT keypair (`JWT_PRIVATE_KEY_V1`, `JWT_PUBLIC_KEY_V1`, `JWT_SECRET`) is
**auto-generated on first boot** and persisted in the `/data` volume. On startup
the container prints the generated values and instructs you to copy them into
Coolify. Do that immediately — if the container is rebuilt before you copy them
the keys change and all live sessions are invalidated.

Alternatively, generate the keys yourself before the first deploy:

```bash
node -e "
const { generateKeyPairSync, randomBytes } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log('JWT_PRIVATE_KEY_V1=' + JSON.stringify(privateKey.export({ type:'pkcs8', format:'pem' })));
console.log('JWT_PUBLIC_KEY_V1='  + JSON.stringify(publicKey.export({ type:'spki', format:'pem' })));
console.log('JWT_SECRET=' + randomBytes(32).toString('base64url'));
"
```

Paste the output into Coolify as three separate environment variable values
(the key ID defaults to `v1`; set `JWT_CURRENT_KID=v1` explicitly if you want
to be precise).

### 4. Add a persistent volume

In Coolify's **Storages** tab for the resource, add a volume:
- **Container path**: `/data`

This persists the local D1 SQLite database, KV store, R2 object storage, and
Durable Object state across container restarts and rebuilds.

> Without this volume every redeploy wipes all inspection data.

### 5. Deploy

Click **Deploy**. The container:
1. Builds the worker bundle.
2. Writes `.dev.vars` from the environment variables you set.
3. Applies any pending database migrations against the local D1.
4. Starts `wrangler dev` bound to `0.0.0.0:8787`.

### 6. Claim the workspace

Visit `https://your-domain/setup` and enter your `SETUP_CODE`, company name,
name, email and password to create the first admin account. The endpoint closes
itself after the first workspace is created.

---

## Environment variable reference

Full table is in [`CLAUDE.md`](../../CLAUDE.md#environment-variables). Summary
of the variables most relevant to a Coolify deployment:

| Variable | Required | Notes |
|---|---|---|
| `APP_BASE_URL` | Yes | Public origin, e.g. `https://inspect.example.com` |
| `SETUP_CODE` | Yes (first boot) | Gates `/setup`; can be removed after first use |
| `JWT_SECRET` | Auto-generated | Persist from container logs after first boot |
| `JWT_CURRENT_KID` | Auto-set to `v1` | |
| `JWT_PRIVATE_KEY_V1` | Auto-generated | Persist from container logs |
| `JWT_PUBLIC_KEY_V1` | Auto-generated | Persist from container logs |
| `RESEND_API_KEY` | Optional | Outbound email |
| `SENDER_EMAIL` | Optional | Required when `RESEND_API_KEY` is set |
| `STRIPE_SECRET_KEY` | Optional | Bring-your-own Stripe account |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook verification |
| `TURNSTILE_SECRET_KEY` | Optional | Bot protection on the public booking page |
| `GOOGLE_CLIENT_ID/SECRET` | Optional | Per-inspector Google Calendar sync |
| `GOOGLE_PLACES_API_KEY` | Optional | Address autocomplete |
| `ESTATED_API_KEY` | Optional | Property facts autofill |
| `AI_BASE_URL` | Optional | OpenAI-compatible API root for AI features |
| `AI_MODEL` | Optional | Model ID for AI features |
| `QBO_CLIENT_ID/SECRET` | Optional | QuickBooks Online integration |
| `QBO_ENV` | Optional | `sandbox` or `production` |
| `APP_NAME` | Optional | Custom branding name |
| `PRIMARY_COLOR` | Optional | Custom branding colour |

---

## Upgrading

When a new release is available:

1. Pull the new code (or let Coolify redeploy from the updated branch).
2. The entrypoint automatically applies any new D1 migrations before starting.
3. No manual migration step is needed for a Coolify deployment.

---

## Data backup

The `/data` volume contains everything: the D1 SQLite file, local R2 objects, KV,
and Durable Object state. Back it up with a volume snapshot or by copying the
directory from the container host.

The D1 SQLite file is at:
```
/data/v3/d1/miniflare-D1DatabaseObject/<database-id>/db.sqlite
```

where `<database-id>` is the placeholder ID from `wrangler.jsonc`
(`00000000-0000-0000-0000-000000000000` unless you changed it in a custom config).

---

## Differences from the Cloudflare deployment

| Aspect | Cloudflare | Coolify / self-hosted |
|---|---|---|
| Runtime | Edge network, global PoPs | Single container on your VPS |
| Database | Managed D1 (Cloudflare replicated SQLite) | Local SQLite in `/data` volume |
| Object storage | Managed R2 | Local filesystem in `/data` volume |
| KV | Managed KV | Local key-value store in `/data` volume |
| PDF rendering | Cloudflare Browser Rendering API | Chromium installed in the container |
| Video | Cloudflare Stream (optional) | Not available; videos stay on local R2 |
| Image downscaling for Word export | Cloudflare Images Transformations | Falls back to embedding at original size |
| Horizontal scaling | Automatic (edge Worker) | Single container; scale vertically |
| Backup | Cloudflare managed | Manual volume snapshots |
