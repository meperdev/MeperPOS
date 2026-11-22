---
date: 2026-11-21
layer: "01+02"
title: CSRF cookie expired before the refresh token
source: "CSRF cookie lifetime ([#392](https://github.com/meperdev/MeperPOS/pull/392))"
pr: 392
paths:
  - "backend/src/auth/cookies.helper.ts (`REFRESH_TTL_MS`)"
tests:
  - backend/src/auth/cookies.helper.spec.ts
  - backend/src/auth/auth.refresh.int.spec.ts
  - e2e/tests/session-restart.spec.ts
---

`csrf_token` was a session cookie while `refresh_token` lived 7 days, so a browser restart dropped only the CSRF cookie: the CSRF-guarded `POST /api/auth/refresh` answered 403 `CSRF token mismatch` and `restoreSession` sent a still-valid session to `/login`. Both cookies now take `maxAge` from the one exported `REFRESH_TTL_MS`; logout still clears `csrf_token` with the same path/httpOnly/sameSite/secure; the guard is unchanged.
