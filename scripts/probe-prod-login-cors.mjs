#!/usr/bin/env node
/**
 * Production login CORS-origin probe — regression guard for
 * `docs/bug-rules/2026-11-22-cors-origin-pwa.md`.
 *
 * On 2026-11-22 login from the PWA (`https://pos-pwa.mepersoft.app`) answered
 * 403 "Cross-origin login rejected": production `CORS_ORIGIN` listed only
 * `https://pos.mepersoft.app`, and `CookieCsrfGuard` (SEC-007) matches the
 * request `Origin` against that allowlist exactly. This probe POSTs to the
 * public login endpoint once per required production Origin and FAILS ONLY on
 * that exact 403, which is the one outcome that means the allowlist lost a
 * frontend.
 *
 *   node scripts/probe-prod-login-cors.mjs             run the probe
 *   node scripts/probe-prod-login-cors.mjs --dry-run   print the plan, no HTTP
 *
 * Fake credentials only. A real `401 Invalid credentials` (or any non-403 auth
 * failure) is the success signal: it proves the Origin cleared the guard and
 * reached the auth check. Never put real credentials here.
 *
 * Non-flaky by contract: an unreachable API, timeout, 5xx or 429 is
 * "inconclusive", warns, and exits 0 — it never fails the job as if CORS were
 * broken. Retries are capped at 2 attempts per Origin and MAX_POSTS (4) in
 * total, which keeps a run under the login rate limit of 5/min (a clean run
 * sends 2 POSTs). The required origins
 * come from `backend/src/config/required-production-origins.json`, the same
 * single source of truth the backend boots with.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN_URL =
  process.env.PROBE_LOGIN_URL ??
  'https://meperpos-api.up.railway.app/api/auth/login';
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_500;
const MAX_POSTS = 4;
const MAX_ATTEMPTS_PER_ORIGIN = 2;
const REJECTION_MESSAGE = 'Cross-origin login rejected';
const PROBE_EMAIL = 'probe@example.com';
const PROBE_PASSWORD = 'not-a-real-password';

const originsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'backend',
  'src',
  'config',
  'required-production-origins.json',
);
const origins = JSON.parse(readFileSync(originsPath, 'utf8'));

if (
  !Array.isArray(origins) ||
  origins.length === 0 ||
  origins.some((origin) => typeof origin !== 'string')
) {
  throw new Error(`No required origins found in ${originsPath}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let posts = 0;

async function postLogin(origin) {
  posts += 1;

  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let message = '';
  try {
    const body = await response.json();
    message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : String(body?.message ?? '');
  } catch {
    // Non-JSON body (a proxy error page): the status is all we have.
  }

  return { status: response.status, message };
}

/**
 * Classify one Origin:
 *   rejected     403 "Cross-origin login rejected" — the only failure
 *   allowed      the guard let the request through to the auth check
 *   inconclusive network/timeout/5xx/429 — warned, never a CORS failure
 */
async function probeOrigin(origin) {
  let last = { kind: 'inconclusive', detail: 'no attempt made' };

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS_PER_ORIGIN && posts < MAX_POSTS;
    attempt += 1
  ) {
    let result;

    try {
      result = await postLogin(origin);
    } catch (error) {
      const code = error?.cause?.code ?? error?.name ?? 'Error';
      last = { kind: 'inconclusive', detail: `network/timeout: ${code}` };
      if (attempt < MAX_ATTEMPTS_PER_ORIGIN && posts < MAX_POSTS) {
        await sleep(RETRY_DELAY_MS);
      }
      continue;
    }

    const { status, message } = result;

    if (status === 403 && message.includes(REJECTION_MESSAGE)) {
      return { kind: 'rejected', detail: `403 ${REJECTION_MESSAGE}` };
    }

    if (status === 401 || status === 400) {
      return {
        kind: 'allowed',
        detail: `${status} ${message || 'fake credentials rejected as expected'}`,
      };
    }

    if (status === 429) {
      return { kind: 'inconclusive', detail: '429 rate limited (not retried)' };
    }

    if (status >= 500) {
      last = { kind: 'inconclusive', detail: `${status} server error` };
      if (attempt < MAX_ATTEMPTS_PER_ORIGIN && posts < MAX_POSTS) {
        await sleep(RETRY_DELAY_MS);
      }
      continue;
    }

    // Any other status is not a CORS rejection: the Origin was not blocked.
    return {
      kind: 'allowed',
      detail: `${status} ${message || 'unexpected status, not a CORS rejection'}`,
    };
  }

  return last;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`[cors-probe] login endpoint: ${LOGIN_URL}`);
  console.log(`[cors-probe] required origins: ${origins.join(', ')}`);

  if (dryRun) {
    console.log(
      `[cors-probe] --dry-run: no request sent. Fails only on 403 "${REJECTION_MESSAGE}"; 401 is success; unreachable is a warning.`,
    );
    return 0;
  }

  const rejected = [];
  const inconclusive = [];

  for (const origin of origins) {
    const result = await probeOrigin(origin);

    if (result.kind === 'rejected') {
      rejected.push({ origin, detail: result.detail });
      console.error(`[cors-probe] FAIL ${origin}: ${result.detail}`);
    } else if (result.kind === 'inconclusive') {
      inconclusive.push({ origin, detail: result.detail });
      console.warn(
        `[cors-probe] SKIP ${origin}: ${result.detail} (not a CORS failure)`,
      );
    } else {
      console.log(`[cors-probe] OK   ${origin}: ${result.detail}`);
    }
  }

  console.log(`[cors-probe] ${posts} POST(s) sent (cap ${MAX_POSTS}).`);

  if (rejected.length > 0) {
    console.error(
      `[cors-probe] production CORS_ORIGIN is missing: ${rejected
        .map(({ origin }) => origin)
        .join(', ')}`,
    );
    return 1;
  }

  if (inconclusive.length > 0) {
    console.warn(
      `[cors-probe] inconclusive for ${inconclusive
        .map(({ origin }) => origin)
        .join(', ')}; exiting 0 because an unreachable API is not a CORS regression.`,
    );
    return 0;
  }

  console.log(
    '[cors-probe] every required production Origin reached the auth check.',
  );
  return 0;
}

process.exitCode = await main();
