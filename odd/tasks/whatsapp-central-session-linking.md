# WhatsApp central session linking

Objective: split the linking of the central `meper-intelligence` phone session into two surfaces — an operations CLI that pairs the phone without any MeperPOS token, and a platform console under `/admin` that reports health and allows re-linking as a real super-admin. Branch `sesion-proveedor-ai-meper-intelligence`. Delivery: work-unit commits on the feature branch; push and PR remain the user's decisions.

Runtime fact: the backend is Express; the central session is one row (`INTELLIGENCE_SESSION = 'meper-intelligence'`) with a partial unique index. The platform role is already persisted as `User.isSuperAdmin` and mapped to the pseudo-role `SUPER_ADMIN` by the JWT strategy; what is missing is the surface, not the column.

## Specs

- S1: «Una cosa el superadmin manejara la sesion del telefono central? o lo manejara cada org?» — resolved as platform ownership: the central session belongs to the platform and is reachable only by a super-admin; each organization owns only its `COMMERCIAL` session and never addresses `meper-intelligence`.
- S2: «LO sigo porque eso de conectar por acces_token desde mi superadmin siempre me pudre jaja.» — primary pairing of the central session must require no MeperPOS access token, no browser, and no super-admin login.
- S3: «O que solucion podemos dar? Tambie se podria manejar desde el superadmin bueno que piensas?» — the super-admin keeps a console to observe the channel and re-link it.
- S4: «Ambas: CLI para el pairing, consola para salud y re-vinculación» — the accepted split: CLI pairs, console reports health and re-links.
- S5: «No dependas del name de sesión para permisos» (inherited constraint from `whatsapp-multi-session.md` S5): the console and the CLI address a channel, never a caller-supplied session name.

## Tasks

- T1 [S2,S5] Operations CLI that pairs the central session: derives the session name, prints the QR, waits for a connected status, persists the observed state; no Nest boot and no JWT. Route: inline. Done: commit `5cc58df` (8 tests RED then GREEN; `tsc` clean; smoke proves `--status` runs with no provider configuration and reports the four missing variables with exit `1`).
- T2 [S1,S3] Backend console read model plus one re-link operation: `GET` returns status, linked account, session name and last observation; `POST /relink` owns the unlink-then-start order. Route: inline. Done: commit `699532f` (2 new tests plus the updated platform surface; `src/whatsapp/` 454 tests green; `tsc` clean).
- T3 [S1,S3,S4] Platform console screen for the central session: status, one-shot QR, re-link with confirmation, stop/restart; super-admin gated; Spanish sentence case. Route: inline (the writer rule did not fire: one screen, its hook and its test are one unit). Done: commit pending (`frontend/src/app/admin/whatsapp` 4 tests green; frontend `tsc` clean; eslint silent).
- T4 [S2,S3,S4] Tests for the CLI pairing path and the console gate, plus `docs/waha-integration.md` covering both surfaces. Route: inline. Done: commit pending (docs section rewritten; the endpoint table gains the read model and `/relink`).

### Delivery slices

| Slice | Contents | Authored lines | Commit |
|---|---|---|---|
| 1 | CLI pairing path and its module | 558 | `5cc58df` |
| 2 | Platform read model and one re-link operation | ~120 | `699532f` |
| 3 | Platform console, hook, page test and docs | ~430 | `a6f0f92` |

Slice 1 crossed the ~400 authored-line guideline because the pairing loop, its eight tests, the command and the feature document landed together; slice 2 was kept as its own commit so the backend authority change can be reviewed alone, and slice 3 keeps the console and its documentation together.

## Log

- L1: «Una cosa el superadmin manejara la sesion del telefono central? o lo manejara cada org? LO sigo porque eso de conectar por acces_token desde mi superadmin siempre me pudre jaja. O que solucion podemos dar? Tambie se podria manejar desde el superadmin bueno que piensas?»
- L2: Evidence: `INTELLIGENCE_SESSION = 'meper-intelligence'` with a partial unique index (`backend/src/whatsapp/whatsapp-connections.service.ts:7`), platform-only controller with `@Roles('SUPER_ADMIN')` and no `OrganizationRequiredGuard` (`backend/src/whatsapp/whatsapp-intelligence.controller.ts:25`), and no frontend surface for the central session (only the organization-scoped delivery screen at `frontend/src/app/settings/(advanced)/whatsapp/page.tsx`). That absence is the mechanical cause of the access-token complaint.
- L3: Correction to the parent's own diagnosis: `isSuperAdmin` is a persisted column (`backend/src/auth/auth.service.ts:577`) mapped to the pseudo-role by `backend/src/auth/jwt.strategy.ts:47-60`, so "persist the platform role" is not new work; the gap is the user-facing surface.
- L4: Decision: the human selected «Ambas: CLI para el pairing, consola para salud y re-vinculación» over the single-surface alternatives.
- L5: Exploration findings: the platform surface already existed (`@Controller('whatsapp/intelligence/session')` at `backend/src/whatsapp/whatsapp-intelligence.controller.ts:23` with `GET /qr`, `POST /logout`, `POST /restart`), `isSuperAdmin` is persisted and mapped by the JWT strategy, and the frontend had no central surface at all. Conclusion: the missing piece was a surface, not an authority model.
- L6: Pre-existing finding, deliberately not folded into this change: `backend/src/auth/jwt.strategy.ts:47,55` grants the platform role when the signed claim says `SUPER_ADMIN` or the row says `isSuperAdmin`, so the claim alone is trusted. Server-minted tokens make it unreachable today, but the row should be the only source. Report it to the human as its own unit.
- L7: Evidence for the three units: backend full suite `4211 passed, 15 skipped, 195 suites` with PostgreSQL up; frontend full suite `872 passed, 97 files`; `tsc --noEmit` clean in both packages; eslint silent on every touched file; command smoke covers `--help` (exit `0`), an unknown argument (exit `1`) and an empty provider environment (exit `1`, naming the four missing variables).
- L8: The repository's own authorization-coverage gate rejected `POST /relink` on the first full backend run because it had no row in `docs/authorization-matrix.md`; the row and its rationale were added and the re-run is green. Recorded because the gate is the reason no route can reach production undocumented.
- L9: Not verified here: the real pairing against a deployed WAHA instance and the physical central phone. This workspace has no provider reachable, so the QR scan itself remains an operator step, not a claimed result.
