#!/usr/bin/env node
/**
 * Docker entrypoint helper.
 *
 * Reads secrets from environment variables (set in Coolify) or loads them from
 * a JSON cache in the persistent volume, falling back to auto-generation for the
 * JWT keypair and JWT_SECRET when neither source provides them.
 *
 * Writes a .dev.vars file in the CWD so that `wrangler dev` picks up all secrets.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DOCKER_DATA_DIR ?? '/data';
const SECRETS_CACHE = join(DATA_DIR, '.generated-secrets.json');
const DEV_VARS_PATH = join(APP_DIR, '.dev.vars');

mkdirSync(DATA_DIR, { recursive: true });

// ── Load persisted auto-generated secrets ────────────────────────────────────
let persisted = {};
if (existsSync(SECRETS_CACHE)) {
  try {
    persisted = JSON.parse(readFileSync(SECRETS_CACHE, 'utf8'));
  } catch {
    // start fresh
  }
}

const env = (key) => process.env[key] || persisted[key] || null;

// ── JWT keypair ───────────────────────────────────────────────────────────────
let jwtPrivKey = env('JWT_PRIVATE_KEY_V1');
let jwtPubKey = env('JWT_PUBLIC_KEY_V1');
let jwtSecret = env('JWT_SECRET');
const generated = {};

if (!jwtPrivKey || !jwtPubKey) {
  console.log('[generate-dev-vars] JWT_PRIVATE_KEY_V1 not set — generating ES256 keypair...');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  jwtPrivKey = privateKey.export({ type: 'pkcs8', format: 'pem' });
  jwtPubKey = publicKey.export({ type: 'spki', format: 'pem' });
  generated.JWT_PRIVATE_KEY_V1 = jwtPrivKey;
  generated.JWT_PUBLIC_KEY_V1 = jwtPubKey;
}

if (!jwtSecret) {
  console.log('[generate-dev-vars] JWT_SECRET not set — generating random value...');
  jwtSecret = randomBytes(32).toString('base64url');
  generated.JWT_SECRET = jwtSecret;
}

if (Object.keys(generated).length > 0) {
  writeFileSync(SECRETS_CACHE, JSON.stringify({ ...persisted, ...generated }, null, 2));
  console.warn(
    '\n  *** AUTO-GENERATED SECRETS ***\n' +
    '  The following secrets were generated and persisted to:\n' +
    '    ' + SECRETS_CACHE + '\n' +
    '  Copy them into your Coolify environment variables so they\n' +
    '  survive container rebuilds:\n' +
    Object.keys(generated).map((k) => '    ' + k).join('\n') +
    '\n'
  );
}

// ── Build the vars map ────────────────────────────────────────────────────────
const vars = {
  JWT_CURRENT_KID: env('JWT_CURRENT_KID') ?? 'v1',
  JWT_SECRET: jwtSecret,
  JWT_PRIVATE_KEY_V1: jwtPrivKey,
  JWT_PUBLIC_KEY_V1: jwtPubKey,
  APP_BASE_URL: env('APP_BASE_URL') ?? 'http://localhost:8787',
  SETUP_CODE: env('SETUP_CODE') ?? 'change-me',
};

const optionals = [
  'RESEND_API_KEY',
  'SENDER_EMAIL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_SITE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_PLACES_API_KEY',
  'ESTATED_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_MANAGED_API_KEY',
  'APP_NAME',
  'PRIMARY_COLOR',
  'QBO_CLIENT_ID',
  'QBO_CLIENT_SECRET',
  'QBO_ENV',
];
for (const key of optionals) {
  const val = env(key);
  if (val) vars[key] = val;
}

// ── Write .dev.vars (dotenv format, double-quoted for multiline PEM values) ───
const dotenvLine = (key, value) => {
  // PEM keys and any value with newlines / embedded quotes must be double-quoted.
  // dotenv preserves literal newlines inside double-quoted values.
  if (value.includes('\n') || value.includes('"')) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${key}="${escaped}"`;
  }
  return `${key}=${value}`;
};

const content = Object.entries(vars).map(([k, v]) => dotenvLine(k, v)).join('\n') + '\n';
writeFileSync(DEV_VARS_PATH, content);
console.log(`[generate-dev-vars] .dev.vars written (${Object.keys(vars).length} variables)`);
