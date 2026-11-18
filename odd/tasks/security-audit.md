# Security audit — continuous cybersecurity audit of MeperPOS

Head: continuous OWASP-based security audit of MeperPOS, run read-only in
`.worktrees/security-audit` (branch `audit/security`), phase by phase, tracked
in `docs/security/`. Phase 0 only is authorized so far.

## Specs

- S1: «Actúa como un Senior Application Security Engineer, Security Architect y auditor especializado en OWASP» — audit is progressive (FASE 0..7), verifiable, evidence-based.
- S2: «En un worktree aparte haras el siguiente trabajo» — all audit work happens in the separate worktree, never the main tree.
- S3: «Comienza exclusivamente por la FASE 0. Explora el repositorio y genera la documentación inicial.» No MeperPOS logic changes.
- S4: «Crea, si no existen, los siguientes archivos en el repositorio: docs/security/README.md, ARCHITECTURE.md, AUDIT_PLAN.md, FINDINGS.md, PROGRESS.md» with findings IDs SEC-001..N, severities CRÍTICA/ALTA/MEDIA/BAJA/INFORMATIVA, per-finding format (ID/Título/Severidad/Estado/Ubicación/Descripción/Evidencia/Escenario de riesgo/Impacto/Validación/Remediación/Regresión).
- S5: «Identifica los cinco riesgos de seguridad más importantes que deberían investigarse primero, basándote en el código real.»
- S6: «No modifiques la lógica de MeperPOS.» during audit phases; remediation (FASE 7) only after explicit authorization.
- S7: «No declares una vulnerabilidad como confirmada sin evidencia reproducible.» Distinguish confirmadas / potenciales / malas prácticas / no verificadas.
- S8: Rules: no real secrets in reports, no destructive tests, no production access, fictional data only for tests, no new tooling without authorization.
- S9: «Finaliza con un resumen de reconocimiento, la cobertura alcanzada, las incertidumbres y la propuesta de la siguiente fase de auditoría.»
- S10: Continuity — every new session reads docs/security/, reconstructs state, continues from next pending objective.

## Tasks

- T1 (S2): create `.worktrees/security-audit` worktree + branch `audit/security`. [done — uncommitted worktree]
- T2 (S1,S3): recon backend (delegated explorer, read-only). [done — spot-checked SEC-001/002/003 first-hand]
- T3 (S1,S3): recon frontend + infra/deps (delegated explorer, read-only). [done — spot-checked seed/compose/CSP first-hand]
- T4 (S4): write docs/security/README.md, ARCHITECTURE.md, AUDIT_PLAN.md, FINDINGS.md, PROGRESS.md in the worktree. [done — 5 files, 10 findings SEC-001..010]
- T5 (S5): register top-5 security risks in FINDINGS.md with SEC-IDs and evidence. [done — part of T4 write]
- T6 (S9): close Phase 0 with recon summary, coverage, uncertainties, next-phase proposal. [done — user approved FASE 1 with «Si»]
- T7 (S3,S7,S8): FASE 1 PoCs with fictional data, non-destructive: SEC-001 CONFIRMED (ADMIN fabrica OWNER + reset de password de OWNER → sesión OWNER), SEC-005 CONFIRMADO (refresh sin CSRF; replay de token rotado; replay post-logout mintea fila RefreshToken ACTIVA, verificado en DB), SEC-007 CONFIRMADO parcial (login cross-origin sin CSRF → 201). Datos ficticios audit.poc.* eliminados y verificados (0 filas en User/Org/RefreshToken). [done]
- T8 (S6,S10): resto de FASE 1 (CSRF en select-organization; interceptor x-organization-id; timing/enumeración login; vías de cambio de rol). [pending]
- T9 (S6,S10): FASE 2 completada — [done]: barrido estático delegado (32 controladores, patrón fallback inventariado, writes post-check, SQL crudo, mass assignment) + batería dinámica IDOR 12/12 en 404, relays 3/3 bloqueados, header x-organization-id ignorado para usuarios, modo SUPER_ADMIN global confirmado. SEC-002: MEDIA (bajada), verificado no explotable por usuarios de org. Datos ficticios limpiados.
- T10 (S6): FASE 7 remediación — [done for SEC-001 + SEC-005, authorized by user «SI»]: guardrails in users.service (actor role checks), RefreshToken.revocationCause column + cause-based grace, CSRF required on refresh; regression tests RED→GREEN; dynamic re-PoC confirms both exploits now fail while legitimate flows pass; build OK. Work-unit commits on audit/security.

## Log

- L1: user request (verbatim): «En un worktree aparte haras el siguiente trabajo: # MEPERPOS — AUDITORÍA CONTINUA DE CIBERSEGURIDAD … Comienza exclusivamente por la FASE 0 … No modifiques la lógica de MeperPOS … Identifica los cinco riesgos de seguridad más importantes … Finaliza con un resumen de reconocimiento, la cobertura alcanzada, las incertidumbres y la propuesta de la siguiente fase de auditoría.»
- L2: worktree `.worktrees/security-audit` (branch `audit/security`, base fa79f06) created and registered in session; ODD doc created before first docs write.
- L3: two read-only explorers launched (backend map; frontend+infra map). No source file of MeperPOS was modified.
- L4: recon results received from both explorers; 6 spot-checks done first-hand (create-user DTO/controller/service; products fallback; cloudinary deleteImage; seed super-admin; docker-compose ports; ENFORCED_SCRIPT_SRC).
- L5: FASE 0 closed: docs/security/{README,ARCHITECTURE,AUDIT_PLAN,FINDINGS,PROGRESS}.md written in the worktree. 10 preliminary findings SEC-001..010; top-5 = SEC-001 (CRÍTICA), SEC-002, SEC-003, SEC-004, SEC-005. No MeperPOS source logic modified; nothing committed (user has not asked for commits).
- L6: risk line for this docs-only change: Risk: none (documentation only; no MeperPOS runtime code path touched).
- L7: user «Si» autorizó la FASE 1 propuesta. PoC ejecutados en localhost con datos ficticios (`audit.poc.*@audit-invalid.test`), sin tocar datos reales; env con `JWT_SECRET` aleatorio generado por sesión; server de pruebas apagado y datos limpiados (0 filas verificadas). FINDINGS/PROGRESS actualizados con los 3 confirmados dinámicos.
- L8: evidence correction to FASE 0 map: `RolesGuard` hereda OWNER ⊃ ADMIN, así que ninguna ruta distingue OWNER de ADMIN hoy; el impacto de SEC-001 es secuestro de cuenta (reset-password sin restricción de rol objetivo) + auditoría falseada + exposición futura. FINDINGS.md SEC-001 actualizado con ese matiz.
- L9: FASE 7 ejecutada: RED (4 tests fallando contra código vulnerable) → fix SEC-001 (users.service create/resetPassword actor checks) y SEC-005 (revocationCause 'rotated'/'logout'/'revoke-all' + grace solo para 'rotated' + CSRF en refresh, migración aditiva sin reset de DB) → GREEN (109/109, 126/126 suites vecinas, build OK). Re-PoC dinámico post-fix: ADMIN→OWNER 403, reset OWNER 403, CASHIER 201; refresh sin CSRF 403, con CSRF 201, replay post-logout 401, refill por rotación sigue vivo. Datos ficticios limpiados (0 filas), server apagado. Observación para FASE 6: drift de migraciones 20261009* modificadas tras aplicar.
- L10: slice boundary recorded: 854 authored changed lines across 3 work-unit commits (ba80bd4 fix SEC-001, 5175c2d fix SEC-005, 2a8b70f docs) on audit/security since fa79f06. Delivery shape (push/PR/merge) is the user's decision; if a PR is wanted, the two fixes can also be reviewed as separate PRs given the migration in the SEC-005 slice. Risk line for the fixes: Risk: item 2 (auth/session guardrails) — covered by dedicated regression specs and dynamic re-PoC, both green.
- L11: FASE 2 cerrada sin hallazgo cross-tenant explotable por usuarios de organización. SEC-002 recalificada ALTA→MEDIA (verificado; riesgo latente solo vía SUPER_ADMIN, amplificado por SEC-004). Observaciones informativas nuevas: 200-null en /sales/number/:n, users.controller org unknown, plan-limits shape null. Cola no cubierta: receipts, fiscal-document, whatsapp ingestion, business-modules, employee-shifts, settings logo.
