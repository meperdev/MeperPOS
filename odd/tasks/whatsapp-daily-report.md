# WhatsApp daily report
Objective: daily and on-demand administrator reports; branch `feat/whatsapp-daily-report`.
Delivery: auto-chain, chain_strategy=feature-branch-chain; runner: backend Jest. Forecast: over 400 authored lines.

## Specs
- S1: «El cierre del dia en ventas, gastos y lo que represente aviso como algun prestamos, orden de compra, stock bajo, etc. Sobre las 8pm hora colombia»
- S2: «3 dias antes. EL reporte del cierre tambien debe tener la opcion del reporte detallado de que se vendio, productos, clientes, etc. Se podria generar un documento con eso o ya es mas pesado de ahcer? SIno como texto plano»
- S3: «Yo creo que mejor todo automaticamente, no creo que no quieran ver siempre el detalle completo y seria una doble solicitud que nos ahorramos»
- S4: «El reporte se podra generar en cualquier momento del dia si el administrador lo solicita, con hora de corta en el momento de la solicitud, pero no es tan normal que lo pida varias veces en un dia asi que por eso se deja el fijo a las 8pm con hora de corte las 8pm.»
- S5: «Mira bien en internet lo del wpp, que de todas formas el usuario se podria pasar al business sin problema, pero si se puede dar soporte a ambos seria bueno.»
- S6: «Dale arranca, crea un worktree para trabajar sin problema.»

## Tasks
- T1 [S1,S2,S4,S6] Explore report semantics and implement secure daily report with PDF and tests; route delegated (context backstop); in_progress: suite passed, commit pending.
- T2 [S1,S2,S3,S4,S5] Implement scheduled and on-demand WhatsApp delivery with explicit authorization and tests; route inline; blocked: provider selection and account configuration needed; commit pending.
- T3 [S1,S2,S3,S4,S5] Verify functional behavior and document configuration and rollout; route inline; pending; commit pending.

## Log
- L1: «Necesito la forma mas facil de integrar un bot con ia a meperpos, que me ayude a avisar via wpp stock bajo, que me envie el reporte diario del dia, que me de la nomina, etc. COMo se puede gestionar de forma rapida y economica? Necesito tambien saber si serviria el mismo para todas las organizaciones o como? Tambien una opcion del bot para gestionar chats de wpp con los clientes. MIra en internet y deim en primera instancia como podria?»
- User: «Por el momento necesito que se encargue de un negocio.»
- User: «3 dias antes. EL reporte del cierre tambien debe tener la opcion del reporte detallado de que se vendio, productos, clientes, etc. Se podria generar un documento con eso o ya es mas pesado de ahcer? SIno como texto plano»
- User: «Yo creo que mejor todo automaticamente, no creo que no quieran ver siempre el detalle completo y seria una doble solicitud que nos ahorramos»
- User: «El reporte se podra generar en cualquier momento del dia si el administrador lo solicita, con hora de corta en el momento de la solicitud, pero no es tan normal que lo pida varias veces en un dia asi que por eso se deja el fijo a las 8pm con hora de corte las 8pm.»
- User: «Mira bien en internet lo del wpp, que de todas formas el usuario se podria pasar al business sin problema, pero si se puede dar soporte a ambos seria bueno.»
- User: «Dale arranca, crea un worktree para trabajar sin problema.»
- Worktree `.worktrees/whatsapp-daily-report` created from `e146bee`; no number migration or external account changes authorized. Payroll source is not yet established; customer chatbot is later scope. Provider selection remains unconfirmed.
- Initial implementation assumption: show PENDING and PARTIAL_RECEIVED purchase orders, and OPEN monetary loans overdue or due within three Bogotá calendar days, including today. DRAFT orders are not pending. This selection is reversible and can be adjusted.
- User: «Yo tengo aca un postgres esa es mi bd local, esa la puedes usar, esta levantada»; use a fresh isolated test database, never the existing business data. Created `meperpos_daily_report_test_6d92f93ee1` locally and applied 44 migrations; leave it in place without deletion.
- Delivery choice: feature-branch-chain (user selected the recommended chain on the feature branch); no push or PR creation authorized by this selection.
- Full Jest first run: 123 passed suites, 1 failed authorization matrix (new endpoints absent), 2,779 tests passed; reported open handles. Matrix updated with routes. Second full Jest with --forceExit: matrix passed but 19 suites / 99 tests failed with PostgreSQL P1001; `pg_isready -h 127.0.0.1 -p 5432 -t 2` reported no response. Await database availability before repeating. No test DB or business DB deleted. PostgreSQL subsequently became available again (background availability check succeeded).
- Full Jest rerun passed 124 suites and 2,780 tests against the dedicated DB; `--forceExit` was required because prior run reported open handles. Exit 0. Independent verifier passed 22 unit/HTTP tests; parent passed PostgreSQL tests; TypeScript build check passed.
- T1 implementation partial: administrator JSON/PDF endpoints and HTTP guard tests; 24 focused tests passed including isolated PostgreSQL, and independent verifier passed 22 HTTP/unit tests and build TypeScript. Independent verifier found no new tenant disclosure; DB fixtures persist in the new dedicated database and its DB run was parent-only. Exact UTC-midnight expense ambiguity and limited PDF Unicode remain documented. No WhatsApp delivery or scheduler implemented. Native assess was unassessable due to untracked files; independent security verifier ran. No commit. npm ci reported 50 dependency vulnerabilities; no audit fixes applied. Delivery strategy decision required before oversized work-unit commit.
