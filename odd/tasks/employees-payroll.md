# Employees and payroll

Implement the approved manual payroll proposal in bounded, verified work units; preserve existing data and unrelated changes. No publication or database migration execution is authorized by this document.
Engram mirror: `odd/employees-payroll/tasks`.

## Specs

S1. "Los empleados pueden existir sin una cuenta si"; "Si me parece bien asi"; "Si" (inactive employees retain history and pending payments; no new shifts or periods until reactivated). Approved proposal: "Nombre, identificación y datos de contacto."; "Cargo y fecha de ingreso."; "Estado: activo o inactivo."; "Modalidad de remuneración de referencia: salario fijo, por día u otro acuerdo."; "Valor de referencia, cuando corresponda."
S2. "Tambien ten en cuenta negocios que no dan un salario fijo al mes, sino tienen un empleado por dias."; "fechas por separado si"; "Día completo o parcial"; "Manual si"; "SOlo uno por dia"; "SI" (una jornada debe tener un valor mayor a $0). Approved proposal: "Observación opcional."
S3. "poderlos hacer en un solo abono total"; "SI, por fecha"; "Si, y el total se suma, no se distribuye, creo que lo hace mas facil ya que solo son posteriores."; "SI es asi, diria que si" (visible grouped shifts and completion).
S4. "Si" (manual fixed-salary period payment with installments; no automatic payroll calculation); "únicamente cuando se abone completa, pero con la opcion de agregar unicamente el abono de forma informativa."; "Si" (installments reduce outstanding balance).
S5. "Solo propietario y administradores"; "Decidir por pago"; "Pero el gasto se genera hasta que el pago se haga completo"; "Que se pueda elegir, pero por defecto sea la del dia que se pago completo".
S6. "El editar es para pagos pendientes o abonos mal hechos. SI un pago se completo y ya se genero el gasto. No deberia dejar editar ya ese pago completado."; "Bloqueada tambien"; "1." (error de registro: nunca entregaste esos $30.000; se corrige el importe y el flujo de caja queda con el dato correcto, conservando el historial).
S7. "Si, asi me gusta" (guided correction, preserve original history, annul linked expense, copy valid installments); "hagamoslo completo de una vez"; "importe completo de una sola vez" (distinguish mistaken entry from actual full reimbursement).
S8. "Perfecto listo" (installments visible in cash flow on actual dates, optional expense only at completion, no duplicate cash flow, real reimbursement as income); "Aprobado, inicia" (approved functional proposal).

## Tasks

- T1 S1,S2: employee identity and manual shift foundation; done: positive amount 92045c4; prior storage cbf62dc/861fa52/a5f6d4d, employee 640920d, shift abe7f0a, decimal fd4255f, controller 58b1ae4, wiring 528c056; full-chain/real HTTP-DB proof remains T5.
- T2 S3,S4,S6: grouped shifts, period payments, installments, state and concurrency; in progress: correct group limit; commit pending.
- T3 S5,S7,S8: optional expense, correction, cash flow and reimbursement integration; bounded work units; commit pending.
- T4 S1-S8: employee/payroll UI and documentation; bounded work units; commit pending.
- T5 S1-S8: independent verification, applicable functional checks and integration proof; commit pending.

## Log

L1: Hola necesito sacar un feature con el modulo de Nomina y empleados. Sera un modulo para ambos.
L2: Aprobado, inicia
L3: Approved functional proposal and exact clarification quotations are recorded above; conversation remains authoritative for full examples and distinctions.
L4: Independent static verification found ownership reassignment; guards added and five structural tests passed. Inactive trigger still rejects updates listing unchanged date or identity fields; correction worker exited before settlement. PostgreSQL execution and Prisma schema validation remain unverified; no migration was executed.
L5: Si, retoma en una nueva
L6: Correction worker reported structural RED 1 failed/5 passed then GREEN 6 passed. Independent verifier mvsvyip4-9-vsse exited before settlement; no independent verdict. Prisma validation and PostgreSQL behavior remain unverified.
L7: prueba a ver, mira mas a detalle que pudo ser sino reintenta
L8: Independent verification mvsysfhr-a-zmt5 found no static candidate defect, focused 6/6 passed. Safe Prisma validation verifier mvsytak0-b-3e9l could not demonstrate an invocation without dotenv, connection, or writes; no CLI or database executed. PostgreSQL behavior remains unverified.
L9: Dale, es que como ando con pruebas de otra herramienta, esta que baja y sube ese postgres capaz cuando prpbaste estaba caido
L10: Independent focused structural 6/6 passed; Prisma safe validation not executed because repository-local temporary paths permit upward dotenv discovery and network namespace unshare was denied. initdb, pg_ctl, postgres unavailable via PATH/pg_config; psql 18.6 exists. No DB started or connected, no migration executed.
L11: Si, ahora si procede con lo que te falta (authorized creation and deletion of a separate temporary test database on local PostgreSQL server; never modify real database).
L12: Independent verifier mvszcpuq-g-hwfy ran migration against user-authorized temporary PostgreSQL database; 18 checks passed including both lock orderings, database dropped; temporary test script removed. Prisma schema validation and full migration chain remain unverified.
L13: Si (authorized local Prisma schema validation with local config, without showing secrets or applying migrations).
L14: Independent verifier mvszv9ya-h-6egn: Prisma validate exit 0, local config loaded and environment loading skipped. Storage remains unwired; no full migration-chain proof.
L15: Storage unit committed cbf62dc; native committed assess unassessable due to untracked declarations, independent static and real PostgreSQL checks completed; no native review started.
L16: Profile storage independent verifier mvszzhgb-j-gas9: no actionable defect, 9 structural tests and Prisma validate passed. Profile migration not executed in PostgreSQL; full chain unverified.
L17: Profile unit committed 861fa52; committed native assess unassessable because of untracked declaration, no native review started; independent verifier completed.
L18: Employee service uncommitted and unwired, 24 mock tests pass; verifier found stale generated client hidden by unknown cast. Full tsc 22 diagnostics elsewhere, baseline unknown. Generation attempt stopped before execution because prisma.config.ts imports dotenv/config; user decision required.
L19: Si (authorized Prisma client generation with local config potentially loading .env; no secret disclosure, database connections or migrations).
L20: Prisma generation exit 0, config reported environment loading skipped. Typed employee service uses tenant-scoped updateManyAndReturn; verifier mvt0kg4z-r-bjsl found no candidate defect, 25 mocked tests and scoped tsc passed. HTTP boolean parsing, runtime PostgreSQL service tests and global tsc (22 diagnostics, baseline unknown) remain pending.
L21: Employee service unit committed 640920d, source 452 lines (separate review slice). Native committed assessment unassessable due untracked declaration; independent verifier completed; no native review started. Delivery strategy: independent work-unit commits as review slices, no push or PR.
L22: Shift service independent verifier mvt0pfxw-t-86ut: 28 mock tests and scoped tsc passed; missing approved observation and exponent-form number validation TypeError were identified. Same numeric decorator occurred in employee DTO.
L23: Decimal validation correction RED 2/53 then GREEN 82; independent mvt0uji9-v-yndi repeated 82/scoped tsc. Observation storage structural 11/Prisma validate passed independently mvt0xe0d-x-ox0a; not PostgreSQL-tested. Generated client again with environment loading skipped. Observation service RED 1/42 then GREEN 84; independent mvt10r69-z-gscp repeated 84/scoped tsc, no candidate defect. HTTP/DB service and whole migration chain unverified.
L24: Reviewable local slices: a5f6d4d storage observation (32 diff), fd4255f decimal fix (66 diff), abe7f0a unwired shift service (434 lines). Native assess of abe7f0a unassessable because untracked declaration; independent verifier completed. No native review started; no push/PR.
L25: Unregistered employee controller: boolean query RED then 37 GREEN; production implicit body conversion bug corrected RED 4/56 then GREEN 150. Independent mvt1c5z3-13-axxb repeated 150 and scoped tsc; no concrete defect. Nest pipe sequencing inspected, but live HTTP and PostgreSQL remain unverified. Unit 58b1ae4 is 500 source lines, one controller/tests/DTO review slice to keep safety tests alongside behavior. Native committed assess unassessable due untracked declarations; independent verifier completed, no native review started.
L26: Payroll module wiring and isolated mocked HTTP; preexisting global status guard order fixed only for payroll after JWT, RED 4 then GREEN. Independent mvt1n4o0-18-k3m6 repeated 163 tests and checked JWT status propagation. Full app, real JWT/DB/migration chain unverified. Do not deploy before required migrations and compatible Prisma client.
L27: Wired unit 528c056 (354 diff) is one review slice; native assess unassessable due untracked declarations; independent verifier completed, no native review started. T1 scope closed; pending shift edits and payment lifecycle proceed under T2.
L28: Read-only scout mvt1p1hi-19-swm3 identified correction ambiguity for pending installments that represent real cash, and future correction copies must not duplicate cash movements. No T2 source changes.
L29: 1.
L30: Pure allocation helper uncommitted; independent verifier mvt1xpmw-1b-br7e passed 7 tests and scoped tsc but found unrequested group-total maximum and undefined zero-value group completion.
L31: Por que habria una jornada en $0?
L32: SI (approved jornada value greater than zero).
L33: Positive shift RED 4/55 then GREEN 59; independent mvt263ww-1e-pwu6 repeated 59/no defect. CHECK NOT VALID preserves old zero rows but blocks subsequent updates until corrected; not executed against PostgreSQL. Committed 92045c4 as own review slice; native assess unassessable due untracked declarations; independent verifier completed.
L34: Pure allocation helper aggregate and zero fixes RED 3/6 then GREEN 9; independent mvt2a0ob-1g-o479 repeated 9 and scoped tsc, no defect. Unwired; no persistence or concurrency proof. Committed 8e875a6 (422 diff) as one review slice; native assess unassessable due untracked declarations, independent verifier completed.
L35: Obligation storage verifier mvt2e2dd-1i-mro8 found no confirmed defect; structural 4 and Prisma validate passed. Unconstrained SQL NUMERIC versus Prisma @db.Decimal drift remains unproven; group membership, CAS, completion and correction not implemented. Not PostgreSQL-tested. Committed 755b654 (160 diff) as own review slice; native assess unassessable due untracked declarations, independent verifier completed.
L36: Shift membership storage RED 3 then GREEN 3; independent found index/FK map drift. Map correction RED 1/3 then GREEN 4, independent mvt2licl-1m-ga2c repeated 4 and Prisma validate. No PostgreSQL execution or live correction; release is a seam only. Future payment transactions must protect shift snapshots/edits and status. Committed 9dbf492 (171 diff) as review slice; native assess unassessable due untracked declarations, independent verifier completed.
L37: Installment storage and allocation limit fix RED 3 then GREEN 13; independent mvt2u2pk-1q-tam0 repeated 13 and Prisma validate, no candidate defect. Prisma migrate diff from empty to schema generated PayrollCashOutflow.amount DECIMAL without precision, consistent with SQL NUMERIC unconstrained; actual applied-database drift/PG behavior unverified. Separate review slices 9e0b83d (allocation fix) and 45b3385 (storage); native committed assess unassessable due untracked declarations; independent verifier completed. No corrections/cash-flow workflow yet.
L38: Unwired group creation RED 19 then GREEN 19; verifier found legacy zero and unresolved shift editing race. Zero correction RED 1/19 then GREEN 25; independent mvt33g3o-1v-hto0 repeated 25 and scoped tsc. Shift date/amount mutation race, PG error mapping and concurrency remain mandatory gates before wiring.
