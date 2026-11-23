---
date: 2026-11-22
layer: "01+02"
title: Production PWA login rejected because CORS_ORIGIN lacked its Origin
source: "Production incident 2026-11-22 (SEC-007 pre-auth Origin check, PR #380)"
pr:
paths:
  - backend/src/config/allowed-origins.ts
  - backend/src/config/required-production-origins.json
  - backend/src/main.ts
  - scripts/probe-prod-login-cors.mjs
  - .github/workflows/prod-cors-probe.yml
tests:
  - backend/src/config/allowed-origins.spec.ts
  - backend/src/common/guards/cookie-csrf.guard.spec.ts
---

`POST /api/auth/login` from `https://pos-pwa.mepersoft.app` answered
`403 Cross-origin login rejected` in production. SEC-007 (PR #380) made
`CookieCsrfGuard.isPreAuthOriginAllowed` compare the request `Origin` exactly
against `resolveAllowedOrigins(process.env)`, i.e. the comma-separated
`CORS_ORIGIN` of the deployment; Railway's `meperpos-api` listed only
`https://pos.mepersoft.app`, so the PWA's Origin matched nothing. Nothing in
the repository knew which production frontends had to be allowed, so the gap
was invisible until a real user tried to log in.

What catches it now:

- `required-production-origins.json` is the committed set of production
  frontends (`https://pos.mepersoft.app`, `https://pos-pwa.mepersoft.app`,
  no trailing slashes, no `meperpos.vercel.app`). It never extends the runtime
  allowlist: `CORS_ORIGIN` stays the only allowlist.
- `warnMissingProductionOrigins` runs at boot and, when `NODE_ENV=production`
  and `CORS_ORIGIN` misses a required Origin (or is unset, leaving the
  localhost defaults), logs the exact missing Origin. It warns only — a
  misconfigured allowlist must not turn into a down API.
- `resolveAllowedOrigins` now trims entries and strips trailing slashes from
  the configured value, because a browser `Origin` never carries one; matching
  stays exact, with no wildcard, prefix or runtime addition.
- `allowed-origins.spec.ts` pins the resolver, the required list and the
  warning; `cookie-csrf.guard.spec.ts` logs in from each required Origin,
  rejects `https://evil.example` and `https://meperpos.vercel.app`, and
  tolerates whitespace/trailing slashes in `CORS_ORIGIN`.
- The daily `Prod login CORS probe` workflow (`schedule` +
  `workflow_dispatch`, never a required check) POSTs to
  `https://meperpos-api.up.railway.app/api/auth/login` with fake credentials
  from each required Origin and fails only on `403 Cross-origin login
  rejected`; `401 Invalid credentials` is the success signal, and an
  unreachable API only warns.
