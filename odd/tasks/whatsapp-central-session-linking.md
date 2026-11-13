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

- T1 [S2,S5] Operations CLI that pairs the central session: derives the session name, prints the QR, waits for a connected status, persists the observed state; no Nest boot and no JWT. Route: inline. Commit: pending.
- T2 [S1,S3] Backend console read model plus the re-link boundary: confirm and complete the platform-only surface so health (status, account, last change), QR and re-link/stop/restart reachable by a real super-admin are exactly what the console needs and nothing more. Route: inline. Commit: pending.
- T3 [S1,S3,S4] Platform console screen for the central session: status, one-shot QR, re-link, stop/restart; super-admin gated; Spanish sentence case. Route: worker. Commit: pending.
- T4 [S2,S3,S4] Tests for the CLI pairing path and the console gate, plus `docs/waha-integration.md` update covering both surfaces. Route: inline plus worker. Commit: pending.

## Log

- L1: «Una cosa el superadmin manejara la sesion del telefono central? o lo manejara cada org? LO sigo porque eso de conectar por acces_token desde mi superadmin siempre me pudre jaja. O que solucion podemos dar? Tambie se podria manejar desde el superadmin bueno que piensas?»
- L2: Evidence: `INTELLIGENCE_SESSION = 'meper-intelligence'` with a partial unique index (`backend/src/whatsapp/whatsapp-connections.service.ts:7`), platform-only controller with `@Roles('SUPER_ADMIN')` and no `OrganizationRequiredGuard` (`backend/src/whatsapp/whatsapp-intelligence.controller.ts:25`), and no frontend surface for the central session (only the organization-scoped delivery screen at `frontend/src/app/settings/(advanced)/whatsapp/page.tsx`). That absence is the mechanical cause of the access-token complaint.
- L3: Correction to the parent's own diagnosis: `isSuperAdmin` is a persisted column (`backend/src/auth/auth.service.ts:577`) mapped to the pseudo-role by `backend/src/auth/jwt.strategy.ts:47-60`, so "persist the platform role" is not new work; the gap is the user-facing surface.
- L4: Decision: the human selected «Ambas: CLI para el pairing, consola para salud y re-vinculación» over the single-surface alternatives.
