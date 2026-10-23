# Monetary obligations: money and performed-service tracking

The L1–L3A backend slices of issue #209 track interest-free MONEY and SERVICE obligations independently
of POS, sales, inventory and financial reports. Partial/full collections update a
backend-derived balance; full payment does **not** close a loan. An administrator
must explicitly confirm closure. Corrections preserve original payments through
separate reversal events, never destructive edits.

## API quick path

Use the existing authenticated cookie session and CSRF protection for mutations.
All routes are under `/api/loans` and require an organization scope.

| Method and path | Permission | Result |
| --- | --- | --- |
| `POST /api/loans` | OWNER, ADMIN | Create a standalone MONEY or SERVICE obligation |
| `GET /api/loans` | OWNER, ADMIN, MEMBER, CASHIER | Paginated loans |
| `GET /api/loans/:id` | OWNER, ADMIN, MEMBER, CASHIER | One scoped loan |
| `GET /api/loans/:id/history` | OWNER, ADMIN, MEMBER, CASHIER | Paginated history of all transitions |
| `POST /api/loans/:id/collections` | OWNER, ADMIN, MEMBER, CASHIER | Partial/full abono |
| `POST /api/loans/:id/collections/:paymentId/reverse` | OWNER, ADMIN | Reverse one collection, with a reason |
| `POST /api/loans/:id/close` | OWNER, ADMIN | Confirm closure only when balance is zero |
| `POST /api/loans/:id/cancel` | OWNER, ADMIN | Cancel only when net collections are zero |

INVENTORY_USER cannot use these routes. Permissions come from the existing
backend role hierarchy, not a frontend check. SUPER_ADMIN retains the existing
role-guard bypass and organization-selection interceptor; select a tenant with
`x-organization-id` (or the existing `organizationId` query selector). Missing
scope fails closed, never producing a cross-organization list. Ordinary operators
cannot change their authenticated organization using that selector or the body.

### Create request

```json
{
  "amount": 120.25,
  "issuedAt": "2026-10-09",
  "dueAt": "2026-11-09",
  "reason": "Anticipo acordado",
  "counterpartyType": "CUSTOMER",
  "counterpartyId": "00000000-0000-4000-8000-000000000001"
}
```

| Field | Contract |
| --- | --- |
| `type` | Optional `MONEY` or `SERVICE`; omission defaults to `MONEY`; null, booleans and inventory types reject |
| `amount` | JSON number, 0.01–99,999,999.99; at most two fractional digits; no numeric-string coercion |
| `issuedAt` | Required valid calendar date, exactly `YYYY-MM-DD` |
| `dueAt` | Optional calendar date; cannot precede `issuedAt`; omission/null means no due date |
| `reason` | Required string, trimmed, 1–500 characters after trimming |
| `counterpartyType` | Exactly `CUSTOMER`, `SUPPLIER` or `EMPLOYEE` |
| `counterpartyId` | One UUID matching that type; no additional counterparty fields |

Customer and supplier records must be active and belong to the selected
organization. An employee is an existing active User with an OrganizationUser
membership in that organization; there is no separate employee directory.
Tenant and actor fields are not accepted in the create body.

### Performed services (tracking only)

Send `type: "SERVICE"` with the same create fields. `reason` describes the
performed service, `issuedAt` is its performance date, `amount` is the agreed
monetary debt, and `dueAt` is its optional payment deadline. The same validated
same-organization customer/supplier/employee is the counterparty. For example,
use `reason: "Reparación realizada"` with the service date and agreed amount.
There is no service catalog, quantity, interest or automatic price calculation.

SERVICE uses the identical collection, reversal, explicit zero-balance closure,
cancellation and authenticated history pipeline as MONEY. Neither creation nor
collection creates a Sale, sale Payment, stock movement, POS operation, revenue
or financial report entry. This is debt tracking, not invoicing or recognition of
service revenue; conversion to a sale is not supported.

### Read responses

Creation, list and detail return `type` (`MONEY` or `SERVICE`) and `status` (`OPEN`, `CLOSED`, `CANCELLED`),
`paymentStatus` (`UNPAID`, `PARTIAL`, `PAID`), `collected` and `balance`.
The two totals are fixed-two-decimal strings derived from collection events minus
reversal events; the client must not compute authoritative money. A cancelled
loan keeps its original unpaid balance as historical evidence, not a write-off.

Creation and detail also return the loan's ID, amount, dates, reason, counterparty
foreign keys and creation actor/timestamp. Exactly one of `customerId`,
`supplierId`, `employeeId` is populated. Related customer/supplier/employee/actor
projections contain only `id` and `name`; no user credentials, email or membership
objects are returned. Prisma Decimal amounts serialize as strings, without
client-side arithmetic or conversion to floating-point response totals. Date
columns serialize as UTC-midnight ISO timestamps.

List and history accept `page` (default 1, maximum 1,000,000) and `limit` (default
20, maximum 100), returning `{ data, total, page, limit, totalPages }`. Loans are
ordered newest-first; history is oldest-first, both with an ID tie-breaker.
List additionally accepts an optional `type=MONEY` or `type=SERVICE` filter;
its rows and count always retain the authenticated tenant scope and pagination
bounds. Omission lists both monetary types; unsupported types reject.
Unknown and foreign-organization IDs both return 404, including on history.
History includes `CREATED`, `COLLECTED`, `REVERSED`, `CLOSED` and `CANCELLED`
events with reason, actor and timestamp. Monetary events expose `amount`, collection
`method`, and reversal `reversesId`; the collection event ID is the `paymentId` used
in a reversal path. Request payloads and internal replay snapshots are not exposed
in read history. There are no principal/counterparty update, delete or history-edit
endpoints.

## Collect, correct and close

1. Send a collection body such as
   `{ "requestKey": "abono-1", "amount": 40.25, "method": "CASH" }`.
2. Read the server's balance; repeat collections until it is `"0.00"`.
3. OWNER/ADMIN sends `{ "requestKey": "close-1" }` to `/close`.

Collection amounts use the same strict JSON-number and two-decimal bounds as
creation. Methods reuse `CASH`, `CARD`, `TRANSFER`; they do not create a sale
`Payment`, cash-register movement, sale, expense or report entry. New mutation results
are `{ type, loanId, eventId, status, paymentStatus, collected, balance }`.
Creation audit metadata and new servicing audit/replay snapshots include `type`.
Pre-L3A stored replay responses remain unchanged on exact retry; their loans are
MONEY by migration default.

To correct an abono on an OPEN loan, send
`{ "requestKey": "reverse-1", "reason": "Corrección de abono" }` to its reversal
path. The reversal negates the original amount, once, while preserving the original
event. It does not execute a bank/cash refund. Cancellation takes the same reason
body and requires no net posted collections; otherwise it returns an actionable
409 asking the administrator to reverse collections first. Reasons are required,
trimmed strings of 1–500 characters. Cross-loan/tenant reversal targets return 404.

### Retries and final states

Every **L2** mutation requires a caller-generated `requestKey`: a nonblank raw
string of 1–100 characters. Keep it unchanged on retry. Keys are scoped to tenant
and loan, shared across operation types, and bound to the authenticated actor and
normalized operation payload. Exact replays return the original stored result,
even after later transitions. Reuse with another payload or actor returns 409;
no extra collection, history event or audit entry is written.

Concurrent conflicts return 409 with instructions to retry the same key. Re-read
the loan when deciding a new amount; never automatically issue a new key after an
uncertain response. L1 loan creation remains non-idempotent.

CLOSED/CANCELLED loans reject all **new** collections, reversals and transitions.
Closure never creates an independent-loan sale. There is no reopen or refund
workflow: correcting a closed loan needs a separate product decision, not a silent
reopen. Principal and counterparty identity remain immutable, including after all
collections are reversed.

## Persistence and review checks

Counterparty validation, loan creation, the append-only creation event and the
existing `AuditLog` entry (`LOAN_CREATED`, resource `MoneyLoan`) use one serializable
Prisma transaction. An event or audit failure must abort creation. Actor IDs are
taken from authentication. Serialization conflicts are surfaced rather than
silently retrying a non-idempotent create request; duplicate submission prevention
is not part of L1.

The L1 migration adds only MoneyLoan and MoneyLoanEvent plus their existing-model
relations. SQL checks enforce a positive amount, date ordering, a nonblank reason
and exactly one counterparty. A composite event foreign key enforces agreement
with the loan's tenant. An SQL trigger rejects history updates/deletes. Restrictive
foreign keys retain loan history when someone tries to hard-delete its referenced
organization, counterparty or actor; existing soft-deactivation remains possible.
Customer/supplier tenant ownership and employee membership are validated by the
service inside the transaction, not by additional directory models.

L2 uses the existing append-only MoneyLoanEvent table as its monetary ledger. A
single Serializable transaction reads the scoped ledger, checks balance/state,
compares-and-swaps the loan's `version` and OPEN status, appends the event/replay
snapshot, and appends `AuditLog` (`LOAN_COLLECTED`, `LOAN_REVERSED`, `LOAN_CLOSED`,
`LOAN_CANCELLED`). All competing mutations contend on the same loan row. There is
no separately stored balance to drift from history. Event/audit failure propagates
and must roll back the entire transaction in PostgreSQL.

The additive L2 migration adds status/version and event money/replay columns;
unique keys prevent duplicate requests and multiple reversals. A composite self-FK
keeps reversal evidence in the same loan and tenant. Shape checks distinguish
creation, collection, reversal and transition records. The L1 append-only trigger
remains unchanged; an additional trigger protects principal/counterparty identity.
Balance/state enforcement and reversal target type/amount validation are service
invariants, not claimed as general SQL protection against arbitrary direct writes.

Review the DTO and real RolesGuard metadata tests first, then the transaction and
tenant-filter tests, and finally the schema/migration pair. SQL checks and the
append-only trigger are migration-owned invariants not expressible in Prisma's
schema. Do not replace this migration with a schema-only database push.

L3A adds only the supported monetary enum and a default-MONEY discriminator to
MoneyLoan, plus an independent immutable-type trigger. MoneyLoan/MoneyLoanEvent
names and ORM mappings stay stable; reviewed migrations, existing identity and
append-only constraints remain unchanged. Existing rows become MONEY without
rewriting history or audit. Decimal totals are valid for both monetary types;
future quantity-based inventory obligations must not use this presenter/ledger.

## Reservation foundation (L3B-A; not operational)

`Product.stock` still means physical on-hand units. The additive migration adds
`reservedStock Int @default(0)` with SQL checks requiring
`0 <= reservedStock <= stock`; positive reservations require an active, tracked
`PRODUCT` (the physical product enum also covers equipment). SERVICE, untracked
and inactive rows must have zero reservations. Existing rows receive zero; a
negative existing stock fails migration validation instead of being rewritten.
Deployment preflight and actual constraint enforcement remain L7 checks.

Product edits retain version CAS and additionally compare the read reservation
quantity and tenant in the conditional write. With reservations, stock equal to
or above the counter and unrelated edits remain allowed; reductions below it,
service/untracked conversion, `update(active: false)`, dedicated deactivation and
hard deletion return 409. Deactivation/deletion also guard version and reservation
quantity; a stale snapshot conflicts before any inventory movement is written.
Missing or inconsistent reservation counters fail closed, never default to zero.
Product create/update reject caller-supplied `reservedStock`; no DTO accepts it.

**Reservation writes remain disabled.** There is no reserve/release/consume API,
operational quantity ledger or inventory-loan API. L3B-B protects stock consumers
and L3B-C adds server availability as described below; neither enables reservation
creation or changes POS or reporting.
Later L3C owns a separate per-loan quantity ledger updated atomically with this
counter, not the monetary ledger or a generic inventory/accounting engine.

Review the additive schema/migration pair and the product reservation tests with
the existing product/service semantics suites. SQL text assertions and mocked
conditional writes do not prove deployed constraints or PostgreSQL concurrency.
Before deployment, L7 must prove migration preflight, invalid writes, real races
and rollback. This unapplied slice can be rolled back as one schema/migration,
product guards/tests and documentation unit; once deployed, removing a populated
counter requires a separately approved data-safe rollback plan.

## Stock-consumer safeguards (L3B-B; reservations still disabled)

Immediate sales can consume only `stock - reservedStock` for tracked physical
products. Inside the existing Serializable transaction, each line reads the live
counter/version and conditionally decrements stock while incrementing version.
The predicate pins tenant, active tracked PRODUCT eligibility, observed version,
observed reserved quantity and `stock >= reservedStock + quantity`. A stale or
insufficient snapshot returns a conflict; reservations are never consumed here.
Prices, tax, cost snapshots, payments and override audits keep their existing
semantics. SERVICE and untracked lines still have no inventory effects.

Cancellation first conditionally claims the same-tenant COMPLETED sale inside
its effect transaction. A losing/repeated cancellation retains the existing
completed-sale error and cannot restock. Each tracked line uses an atomic stock
increment plus version increment, guarded by tenant, observed version and
reservation quantity. A failed restock aborts the transaction, including the
status claim and any earlier movements; no stale absolute stock write remains.
RETURNED_PARTIAL continues to change status without restocking. This does not
introduce a refund, reopen or inventory-loan cancellation policy.

The service backfill pins live tenant/stock/version and requires exactly zero
reservations before conversion to SERVICE/stock zero. Positive or missing
counters refuse conversion; a changed counter fails the tested CAS predicate.
It performs no reservation repair. Purchase receiving already uses versioned
atomic increments, and product imports delegate to product creation.

Review sale CAS predicates, cancellation claim-before-effects tests, then the
pure backfill guard consumed by the CLI. DB-free mocks prove predicate structure
and transaction failure propagation, **not** real concurrent locking or database
rollback. No backfill CLI or PostgreSQL operation was run for this slice. L7
still owns those proofs. Rollback boundary: sale safeguards/tests, the backfill
guard/CLI wiring/tests and this documentation; retain the L3B-A schema/product
guards and keep all reservation writers disabled.

## Server-owned availability (L3B-C; reservations still disabled)

Product create/update/list/detail, search, quick-search and low-stock responses
add `availableStock: number | null`. One backend helper derives tracked PRODUCT
availability as `stock - reservedStock`; SERVICE and untracked merchandise return
`null` (no finite inventory), not zero. Actual persisted type, tracking flag,
physical stock and reservation counter are required. Missing, non-integer,
negative or over-reserved inputs fail closed, never default or clamp.

`available=true` filters tracked rows with the Prisma field-reference predicate
`stock > reservedStock`; SERVICE and untracked rows remain eligible even at zero
physical stock. Tenant, search, category, type, IDs and physical low-stock filters
are composed before both paging and count. Omitting availability or passing false
keeps the previous list eligibility.

This is additive: physical `stock`, `isLowStock`/`minStock`, the raw SQL physical
low-stock predicate, prices, effective tax/promotion fields and Decimal handling
are unchanged. Thin search payloads keep their prior keys; raw low-stock rows keep
`categoryName` and all stored fields. Revenue reports are not modified.

**L6 frontend handoff:** update Product types/hooks and POS, inventory and
ProductCard consumers to read the server field, distinguish null from zero, and
avoid client subtraction. No frontend or complete UI availability audit is part
of L3B-C. Reservation writers stay disabled pending L3C and checked consumers.

DB-free tests cover all seven response paths, helper validation, field-reference
selection and pagination/count parity. They do not prove PostgreSQL field-reference
execution, locking or constraints; L7 retains those proofs. Rollback boundary:
this availability helper/wiring, its product contract tests/fixtures and this
section; preserve the L3B-A/B guards and keep reservation writers disabled.

## Physical-loan foundation (L3C-A; UNEXPOSED)

InventoryLoan, InventoryLoanItem and InventoryLoanEvent are separate from the
MONEY/SERVICE monetary ledger. This slice adds persistence declarations and pure
quantity rules only: **reservation writers remain OFF**, with no inventory-loan
endpoint, module wiring, transaction writer, sale, Payment, report or POS change.
Existing monetary servicing and stored replay snapshots are unchanged.

### Approved accounting: reserve, then explicitly deliver

| Operation | Physical stock | Reservation | Item evidence |
| --- | --- | --- | --- |
| Create | Unchanged | Increase by item quantity | Positive quantity; counters start at zero |
| Explicit delivery | Decrease by delivered units | Decrease by the same units | Increase deliveredQuantity |
| Recorded return | Increase by returned units | Unchanged; never release twice | Increase returnedQuantity |
| Undelivered cancellation | Unchanged | Release remaining undelivered units | Increase cancelledQuantity |

Derive `reservedRemaining = quantity - deliveredQuantity - cancelledQuantity`
and `outstanding = deliveredQuantity - returnedQuantity`; neither is stored.
Counts must be finite integers within Prisma Int (0–2,147,483,647), with positive
item quantity, `returnedQuantity <= deliveredQuantity`, and
`deliveredQuantity <= quantity - cancelledQuantity`. Pure transitions return new
counts and stock/reservation deltas without mutating inputs or writing anything.
A return does not reopen the reservation or permit a second delivery of those
units. Stock capacity, availability and transaction policy belong to later writers.

Header cancellation is restricted to loans with no historical delivery on any
item. Once any unit has been delivered, even when fully returned, use explicit
CLOSED instead; outstanding delivery must first be resolved by recorded returns.
The item helper only proposes an undelivered release; it does not authorize
header cancellation. L3C-C owns that atomic policy and explicit closure. The foundation declared OPEN and CANCELLED;
the additive C-C-A vocabulary and pure close policy are described below.

### Tenant and evidence boundary

Exactly one nullable customer/supplier/employee is selected. Composite foreign
keys bind customers and suppliers to the loan organization; employeeId references
the existing OrganizationUser `[userId, organizationId]` membership. Default SQL
MATCH SIMPLE permits the unselected nullable counterparties. Item foreign keys
bind both loan and Product to the same tenant. An event's optional item references
`[id, loanId, organizationId]`, preventing cross-loan history even within one org.
Existing primary-key relations remain intact; additive directory/product unique
indexes support these foreign keys. Creator/event actors reference User; role and
active-entity eligibility checks remain later service responsibilities. No
isLoanable field, new employee directory or database active-entity guarantee exists.

CREATED is a header event with null item/quantity. DELIVERED and RETURNED require
an item and positive quantity. CANCELLED supports a null-item/null-quantity header
plus positive per-item undelivered reservation releases. A zero-release item gets
no item cancellation event; the header can still record cancellation. L3C-B must
store immutable actor/payload/result and idempotency at **operation level**, since
one operation can append multiple item events. No per-item unique request key is
introduced here.

SQL checks enforce quantity bounds/event shapes. Triggers reject event updates or
deletes, loan/item deletion, identity changes (including item loan/product/quantity)
and decreasing accumulated item counters. They do not prove ledger/counter/stock
agreement against arbitrary direct writes. L3C-B creation/read/history/replay and
L3C-C atomic delivery/return/cancellation must enforce that agreement with tenant,
role, active tracked PRODUCT, version/CAS, audit and replay checks before rollout.

### Review, proof and rollback

Review pure accounting tests first, then schema/FK/event-shape declarations and
immutable-evidence triggers. Text assertions prove declarations only; schema
validation/client generation do not execute PostgreSQL. L7 still needs authorized
isolated migration execution, FK/check/trigger rejection, atomic rollback and real
race/reconciliation proof. No migration has been applied by this unit.

Before application, the rollback boundary is these three models, their required
reverse relations/composite indexes, the inventory foundation migration, pure
rules/tests, structural spec and this section. Preserve all monetary and L3B
reservation guards. After deployment/population, require a separately authorized
data-safe rollback plan; never discard loan evidence or reset reservations.

## Physical-loan replay storage (L3C-B first unit; UNEXPOSED)

This additive DDL-only unit introduces `InventoryLoanOperation` and an optional
`InventoryLoanEvent.operationId`. **Reservation writers remain OFF.** No service,
DTO, route, module wiring or runtime replay matcher is added. Monetary models,
replay snapshots and the approved L3C-A migration remain unchanged.

### Completed immutable evidence

| Declaration | Contract |
| --- | --- |
| `organizationId, requestKey` unique | One tenant-wide namespace, independent of loan and actor; another tenant may reuse the key |
| `loanId, organizationId` FK | Operation belongs to a loan in the same tenant |
| `actorId, organizationId` FK | Authenticated actor reuses the existing OrganizationUser membership |
| `type` | CREATE only; later L3C-C discriminators require an additive migration, not monetary enum changes |
| `requestPayload, resultSnapshot` | Required nonempty JSON objects, no pending/null placeholders |
| `requestKey` | Stored normalized text, 1–100 characters, without leading/trailing SQL spaces; future DTO must trim and reject blank/oversized keys |
| `createdAt` | Required creation timestamp; all operation columns are immutable |

The operation trigger rejects every UPDATE and DELETE, including no-op updates,
identity/actor/key changes and payload/result/timestamp rewrites. No overwritable
conflict upsert is permitted. JSON shape checks do not validate business payloads
or presentation content; the future service owns normalization and safe snapshots.
Restrictive FKs retain membership and loan evidence against hard deletion; active
membership and role authorization remain service responsibilities.

A linked event references operation `[id, loanId, organizationId, actorId]` through
`[operationId, loanId, organizationId, createdById]`, binding the same loan, tenant
and author. Many header/item events may share one operation; there is no unique
request key on events. MATCH SIMPLE intentionally permits old events with null
operationId. All other FK components are required, so a nonnull operationId cannot
skip loan/tenant/actor checks through a nullable companion. Correlation is supplied
at event INSERT; the existing append-only event trigger stays intact. This unit
neither rewrites the foundation migration nor updates historical events.

### Handoff to the unwired L3C-B service unit

1. Normalize the accepted request and key; derive actor/tenant from authentication.
   Look up the tenant-wide key and require stored actor, operation type and
   normalized payload to match. Return the stored snapshot on an exact replay;
   reject a mismatched actor/payload without creating another reservation. Do not
   re-present a replay from live counts or later history.
2. In one future Serializable transaction, create header/items and apply guarded
   reservations, then build a safe presentation snapshot from those created rows.
3. Insert the completed immutable operation **before** inserting linked append-only
   events; append audit in the same transaction. Failure at any step must abort
   header/items, reservations, operation, events and audit together. Handle key/
   serialization conflicts without overwriting the stored operation.

L3C-C will reuse the operation-to-many-events plan for multi-item delivery, return
and cancellation requests, with separately reviewed payload/result/state rules.
No close semantics or lifecycle writer is introduced here. Future read/history
presenters must not expose internal request payloads or replay records.

### Proof and rollback boundary

SQL/schema assertions verify declarations and alignment only; they do **not**
execute invalid writes or prove FK, check, trigger, rollback or race enforcement.
Prisma validation/generation likewise provides no real PostgreSQL proof. L7 still
requires separately authorized isolated database execution; this migration is
unapplied. Before application, remove this operation model/reverse relations,
event link, new 090500 migration, operation declaration tests and this section as
one unit; retain L3C-A and all monetary/reservation safeguards. After population,
require an authorized data-safe rollback plan, never a table wipe or evidence edit.

## Physical-loan creation and reads (L3C-B second unit; UNWIRED)

`InventoryLoansService` and its nested DTO are implemented for direct test
instantiation only. **Operational rollout remains OFF.** The service is not
registered or exported by a Nest module, controller, route or application.
The foundation/storage sections above describe their earlier isolated units;
this section adds the unwired writer, not an inventory-loan HTTP API.

### Create contract and reservation

| Input or boundary | Contract |
| --- | --- |
| `requestKey` | Raw string trimmed to 1–100 characters; tenant-wide namespace |
| `counterpartyType`, `counterpartyId` | CUSTOMER, SUPPLIER or EMPLOYEE and one UUID; active same-tenant entity; employees reuse User plus OrganizationUser membership |
| `items` | 1–100 nested items, each with registered product UUID and raw positive integer quantity up to 2,147,483,647 |
| Duplicate products | Reject rather than merge; item order is nonsemantic and normalized by product ID |
| Unknown fields | Reject at header and item level, including prices, tax, cost, stock, reservations, version, actor and tenant; no due-date or notes persistence is claimed |
| Actor | Authenticated RequestUser, separate from the DTO; OWNER/ADMIN and an active administrative same-tenant membership required |
| SUPER_ADMIN | No global bypass: also requires an active OWNER/ADMIN OrganizationUser membership in the selected tenant |

Service-side validation also protects direct callers that bypass a future HTTP
validation pipe. Missing organization fails closed. MEMBER, CASHIER and
INVENTORY_USER cannot create these obligations. This is service authorization,
**not implemented HTTP role metadata**; future controllers must enforce their
own guards and organization selection.

One Serializable transaction validates the actor, counterparty and each active,
tracked PRODUCT. Sequential product-ID ordering gives a stable reservation lock
order. Each reservation update pins tenant, eligibility, observed version,
reservedStock and physical stock, and requires enough stock minus reservations.
It increments only reservedStock and version; physical stock is unchanged.
Missing/inconsistent controls, insufficient availability or a lost CAS return
409. There is no InventoryMovement OUT, Sale, Payment or MoneyLoan write.

Header/items, completed immutable CREATE operation, linked header CREATED event
and INVENTORY_LOAN_CREATED AuditLog share the transaction. The JSON-safe response
snapshot is built from created rows with ISO creation time and derived quantities.
The operation is inserted before its linked event; neither pending placeholders
nor later event/operation updates are used. Any failure aborts all staged effects.

### Exact replay and public reads

An exact request must match stored actor, CREATE discriminator and the complete
normalized typed-counterparty/item payload. It returns the stored creation
snapshot, even after live status, item counts or counterparty eligibility change;
it never computes a new result from current rows or writes additional evidence.
Mismatched requests return 409 before reservations. Different tenants may reuse
one key without sharing lookups or results. Malformed snapshots fail closed.

P2002/P2034 reconciliation re-reads the tenant key only **outside** the aborted
transaction. A matching completed operation permits replay; missing or mismatched
evidence returns 409. There is no automatic reservation retry, conflict upsert,
or assumption that any unique-key violation means success.

List uses one composed tenant/status/typed-counterparty predicate for page and
count. The unwired query validator explicitly accepts OPEN, CANCELLED and CLOSED;
unknown statuses reject. List/detail present live status and counters, while the
immutable CREATE replay snapshot remains strictly OPEN-only. The earlier B and
C-C-A/B/C units retained an OPEN/CANCELLED query guard; CLOSED filtering is added
only by this narrow internal read-query gate, not by enum generation.
Counterparty filters require both type and ID. Page/limit are bounded to
1–1,000,000 and 1–100, defaulting to 1 and 20. List ordering is createdAt/id
descending; history is ascending with the same ID tie-breaker. Responses use
`{ data, total, page, limit, totalPages }`.

Detail and related item selectors retain tenant scope. Derived reservedRemaining
and outstanding use the existing quantity invariant helper and live item counters.
History first requires a same-tenant loan, then scopes both page and count to its
tenant/ID. Public reads expose scalar counterparty/actor IDs and immutable event
ID, type, item, quantity, actor and timestamp, not membership credentials, internal
request payloads, operation relations or stored replay records. Wrong-tenant and
missing loans both return 404.

### Proof limits and lifecycle handoff

The predicate-aware DB mock clones working state and commits only a successful
callback. Tests demonstrate local rollback on operation/event/audit/CAS failures,
reservation/read predicates and replay effects; they **do not** prove PostgreSQL
locking, actual rollback, FK/check/trigger enforcement or concurrent races.
Schema/client are unchanged in this unit; prior validation/generation evidence
is reused, not rerun. L7 retains separately authorized isolated database proof.

L3C-C must implement explicit delivery, recorded returns, cancellation and closure,
add any required lifecycle operation discriminators, then define controller guards
and read permissions before considering rollout. No pricing decision, POS,
frontend, financial reporting or monetary replay behavior changes here. The
second-unit rollback boundary is its DTO/service/spec and this documentation;
retain checked storage, pure invariants and all stock-consumer safeguards.

## Physical-loan close plan (L3C-C C-C-A; UNWIRED)

**Operational rollout remains OFF.** This unit adds lifecycle vocabulary and
`planInventoryLoanClose`, not transactional servicing, stock writes or HTTP routes.
The existing CREATE replay validator remains strictly OPEN-only; new enum values
are not permission to weaken operation-specific payload or snapshot validation.

### Explicit closure policy

| Condition | Pure proposal |
| --- | --- |
| Nonempty items with valid Prisma Int counts/allocation | Required; every item is validated, including untouched items |
| Every item has `deliveredQuantity - returnedQuantity = 0` | Required; all delivered units must have recorded returns |
| At least one delivered unit somewhere in the loan | Required; zero-delivery loans must use CANCELLED, even if fully released |
| Partial fulfillment or untouched items | Allowed when another item has a returned delivery |
| Undelivered remainder | Release `quantity - deliveredQuantity - cancelledQuantity` by increasing cancelledQuantity |

Closure is explicit, never automatic when returns finish. Each plan entry contains
fresh counts, releaseQuantity and resulting reservedRemaining/outstanding (both
zero). Quantity, deliveredQuantity and returnedQuantity stay unchanged; prior
cancellations are preserved. Frozen caller inputs are not mutated, and separate
calls do not share result objects. Minimum delivery uses a positive-item predicate,
not an aggregate integer sum. The helper emits no physical stock delta, terminal
status claim, events, transaction or persistence guarantee.

### Vocabulary versus enforcement

New additive 090600 declares CLOSED status, a CLOSED header-only event with null
item/quantity, and DELIVER/RETURN/CANCEL/CLOSE operation types alongside CREATE.
It replaces only the actual event-shape constraint, retaining CREATED and CANCELLED
headers and positive DELIVERED/RETURNED/CANCELLED item shapes. Undelivered releases
can retain positive item CANCELLED evidence; CLOSED itself cannot be an item event.
Nullable operation correlation, same-operation/loan/tenant/author foreign keys and
immutable event/operation protections remain unchanged. Approved 090400/090500
are not rewritten; no money, movement linkage or reporting fields are added.

The constraint compares enum text to avoid consuming a newly added enum literal
before commit. Declaration tests and Prisma validate/generate are **structural**
checks, not proof of actual migration execution or PostgreSQL-version compatibility.
All-returned/minimum-delivery and release accounting are pure behavior checks, not
SQL enforcement of aggregate lifecycle policy. Future parent-owned transactional
service units must atomically claim status, guard versions/reservations, persist
counts, operations, correlated events and audit with rollback/replay guarantees.
Controller wiring, loan-specific movements, frontend and the authorized isolated
L7 database gate remain pending. No migration was applied or real database used.
The existing native R3 snapshot/payload consistency warning remains a separate
follow-up; this unit neither fixes it nor reopens approved B.

Before application, this unit's rollback boundary is the three enum additions,
090600 migration, close helper/tests, lifecycle declaration checks and this section;
retain approved B storage/service and all earlier quantity/reservation safeguards.
After application, any rollback requires a separately approved data-safe plan.

## Internal physical delivery and return (L3C-C C-C-B; UNWIRED)

**Operational rollout remains OFF; all migrations remain unapplied.** This unit
adds only direct-call `InventoryLoansService.deliver(id, dto, actor)` and
`returnItems(id, dto, actor)`. No controller, module registration/export, HTTP
route, terminal lifecycle activation or inventory-ledger integration is added.
At the time of C-C-B, CREATE's strict OPEN/zero-initial-counter replay shape and
OPEN/CANCELLED query filter remained unchanged. The later internal read-query
gate above adds CLOSED filtering without changing CREATE replay.

### Request, actor and stock contract

Both methods accept `{ requestKey, items: [{ itemId, quantity }] }`. Keys are
trimmed to 1–100 characters; select 1–100 loan-item UUIDs with raw positive Prisma
Int quantities. Duplicate IDs reject; selected items are canonicalized by ID.
Nested whitelist validation rejects unknown fields through a ValidationPipe and
also at the service boundary without HTTP. Tenant, actor, product IDs, prices,
notes and stock controls are not request fields.

OWNER/ADMIN authorization requires an actual same-organization administrative
OrganizationUser membership and active User. SUPER_ADMIN needs that membership
too; cashier collection permissions are not borrowed. The lifecycle actor may
be different from the loan's original `createdById`.

| Operation | Eligible product | Stock/count effects |
| --- | --- | --- |
| DELIVER | Active, tracked physical PRODUCT in the same tenant | Decrease stock and reservedStock equally; increase deliveredQuantity within undelivered reservation |
| RETURN | Tracked physical PRODUCT in the same tenant, including inactive products with zero reservations | Increase stock only; increase returnedQuantity within delivered outstanding units |

Every count, version and resulting stock/reservation counter must fit Prisma Int.
Missing, inconsistent, insufficient or overflowing controls fail closed. A return
never restores a consumed reservation, releases it twice, enables redelivery or
closes the loan. Full delivery and full return both leave status OPEN. Fresh
operations on CLOSED/CANCELLED loans reject.

### Atomic claims and immutable replay

One Serializable transaction authorizes the actor and reads the tenant-bound
loan/items. It claims the OPEN header by organization/ID/status/version and
increments that version once. InventoryLoanItem has **no version**: each selected
write pins organization, loan, item/product identity, allocation and all three
observed counters. Product writes retain both version and physical-stock/
reservation CAS guards, including eligibility. Products are processed in sorted
ID order with one aggregated CAS per product. The actual schema has no unique
loan/product constraint, so multiple same-product items are handled defensively.

After the result is known, the transaction inserts one completed immutable
operation, then correlated positive-quantity DELIVERED/RETURNED item events, then
INVENTORY_LOAN_DELIVERED/INVENTORY_LOAN_RETURNED AuditLog. Loan claim, item and
product writes, operation, every event and audit must roll back together on any
failure. No Sale, Payment, money obligation or InventoryMovement is written.

The tenant-wide operation key must match actor, operation type, loan and the
entire canonical selected-ID/quantity payload. Exact replay returns stored JSON,
not live counts, status, product eligibility or names; current active actor
membership is still required. P2002/P2034 reconciliation reads completed evidence
only outside the aborted transaction. Absent/conflicting winners return 409;
there is no blind retry or overwritable pending operation.

DELIVER/RETURN use their own version-1 receipt, separate from CREATE. It contains
type/actor metadata, ordered item IDs and safe before/after count projections.
Validation requires exact keys, tenant/loan identity, one nonnull nonblank
counterparty, unique ordered item IDs, count/derived invariants and unchanged
header/product identities. The pure transition helper must reproduce each
selected request quantity's exact delta; untouched items must remain unchanged.
Only the validated after projection is returned. Request payloads, receipt
metadata and before-count evidence never become public response fields.

### Pre-rollout gates and proof limits

- **Product eligibility gate:** ProductsService now rejects an actual change to
  the final normalized type/tracksStock pair when any same-tenant/product loan
  item has deliveredQuantity greater than returnedQuantity, even with zero
  reservedStock. The field-reference existence query has no loan-status filter:
  terminal records with outstanding units still block, and cancelledQuantity
  never substitutes for returnedQuantity. Fully returned, never-delivered and
  unrelated tenant/product items do not block conversion.
  Conversion alone uses a Serializable transaction containing this query, the
  existing tenant/active/version/reservation-pinned product CAS and read, and
  the existing stock-adjustment movement. Names, prices and normalized same-pair
  requests remain query-free on the ordinary update path. Reservation guards,
  service/untracked normalization and inactive tracked physical returns remain
  unchanged. Cloned-state tests establish local query placement and rollback on
  CAS loss or late movement failure, not PostgreSQL SSI/race/rollback proof.
  Independent verification and L7 database proof remain pre-rollout requirements.
- **Stock-ledger/report gate:** At C-C-B, InventoryMovement had no loan-specific
  enum or linkage. M1 below adds storage declarations only; the service still
  writes no movements. DELIVERED/RETURNED loan events and AuditLog are not proof
  of ledger, reporting or export integration. SALE/RETURN types are not repurposed.
- **Remaining lifecycle/HTTP gate:** internal CANCEL/CLOSE are described below;
  further lifecycle query work, controller permissions/wiring and frontend remain gated.
  No automatic closure,
  payment, sale or money semantics are introduced.
- **L7 database gate:** predicate-aware cloned-store tests prove local success-only
  commit, CAS predicates, staged rollback and outside-abort reconciliation, not
  real concurrent interleavings. PostgreSQL constraints, locks, actual rollback,
  migrations and runtime authentication still need isolated authorized proof.
  Schema/client are unchanged; prior writer Prisma validate/generate evidence is
  reused, not rerun. Independent fresh foundation validation remains blocked,
  not a new pass. The separate informational native R3 CREATE snapshot/payload
  follow-up is neither fixed nor reopened here.

Before migration application, this unit's rollback boundary is the two methods,
operation DTO, receipt helpers, expanded local spec and this section. Preserve
CREATE/read behavior, foundation helpers/storage and all stock-consumer guards.
No production-readiness or native review approval is claimed.

The product-eligibility work unit can be rolled back independently through
ProductsService's conversion transaction and movement-delegate extension, its
service-type/reservation specs and the eligibility documentation above. It adds
no schema, routes, roles, movement taxonomy or financial behavior; ordinary
updates are not newly transactional.

## Internal physical cancellation and closure (L3C-C C-C-C; UNWIRED)

**Operational rollout remains OFF; HTTP is unwired and all migrations remain
unapplied.** Direct-call `cancel(id, dto, actor)` and `close(id, dto, actor)` add
explicit terminal transitions only. The existing 090600 event shapes and
operation storage suffice; this unit changes no schema, SQL, pure helper,
product-conversion guard, module, controller or query allowlist at that time.

### Policy and request

Both methods accept only `{ requestKey }`: a raw string trimmed to 1–100
characters. Runtime validation and the terminal DTO reject unknown fields,
coercible non-string keys and blank loan identities. Neither reason nor item
quantities are request fields. Actual same-tenant OWNER/ADMIN membership with
an active User is required before replay, including SUPER_ADMIN. The actor may
be different from the original creator; CASHIER has no inherited permission.

| Transition | Required OPEN-loan evidence | Result |
| --- | --- | --- |
| CANCEL → CANCELLED | Nonempty valid items; **every deliveredQuantity is zero** | Release all undelivered remaining reservations |
| CLOSE → CLOSED | Existing pure close plan: nonempty valid items, every outstanding count zero, at least one historical delivery | Release all undelivered remaining reservations |

Historical delivery permanently excludes CANCEL, even after full returns.
Partial fulfillment and untouched items permit CLOSE when another item has a
fully returned delivery. Neither full return nor zero remaining reservation
changes status automatically. Both operations increase only cancelledQuantity
by the remaining undelivered allocation; quantity, deliveredQuantity,
returnedQuantity and physical stock are unchanged. Prior cancellations remain.
There is no autoreservation, restoration, redelivery, reopening, payment, sale,
MoneyLoan or InventoryMovement write.

### Atomic terminal claim and evidence

1. In one Serializable transaction, authorize the actor, check the tenant-wide
   key, read the scoped header and validate every item's tenant/loan binding.
2. Claim OPEN/status/version once, set the terminal status and increment version.
   Pin **every** item by tenant, loan, item/product IDs, allocation and observed
   counters, including zero-release items. Items have no version column.
3. Aggregate positive releases by product, then process sorted product IDs with
   one reservation-only CAS each. The schema has no unique loan/product key;
   duplicate products across distinct items are supported, not double-written.
   Pin active tracked PRODUCT eligibility, tenant, version, stock and reservation
   counter; reject Int overflow, under-reservation and inconsistent stock. Stock
   is compared but never modified. Zero-release products are not read or written;
   they do not fabricate physical restoration or product-conversion safeguards.
4. Store one completed immutable CANCEL/CLOSE operation before correlated events.
   Append positive per-item **CANCELLED** release events only when quantity > 0,
   then exactly one null-item/null-quantity CANCELLED or CLOSED header and the
   corresponding INVENTORY_LOAN_CANCELLED/INVENTORY_LOAN_CLOSED AuditLog.

Every header/item/product CAS loss or thrown write, operation failure, later
release event, header event or audit failure aborts all effects together.
P2002/P2034 reconciliation runs only outside the aborted transaction, rechecks
active administrative membership, then reads completed tenant-key evidence.
Absent or conflicting winners return 409; there is no blind retry or upsert.

### Terminal receipt and replay

The separate exact-key version-1 terminal receipt contains type, actor, ordered
item IDs, positive releases and full safe before/after projections. It does not
weaken CREATE's parser or the DELIVER/RETURN receipt contract. Canonical requests
bind operation type and loan identity; operation metadata binds tenant, key and
actor. Other operation types, actors or payloads using the key conflict.

Validation requires before OPEN and the operation-specific terminal after status,
valid creator/timestamp, exactly one nonnull nonblank counterparty (others null),
unique ordered item IDs, nonblank product IDs, bounded counts and derived values.
Products need not be unique across items. Header/item identities and metadata
remain identical except status and cancelledQuantity. Recomputing the complete
pure close plan or never-delivered cancel plan must reproduce every count and
release, including untouched/zero-release items. Extra/private fields reject.
Only the validated after projection escapes; payloads, before evidence and receipt
metadata are not returned. Replays neither mutate evidence nor consult live
status, counts, product controls or names.

### Review and proof limits

Review terminal policy exclusions first, then all-item CAS and same-product
aggregation, event order/rollback, strict DTO and corrupt-receipt cases. The
success-only cloned-store harness proves mocked predicates and staged rollback,
**not** PostgreSQL constraints, locks, interleavings or actual database rollback.
No new SQL proof, Prisma validation/generation or migration execution is claimed.
Prior writer CLI evidence is reused only; independent fresh foundation validation
remains blocked, not passed. L7 isolated database/runtime authorization proof is
pending. Product conversion, movement ledger/report/export integration, frontend,
HTTP permissions/wiring remain separate gates. CLOSED query-filter activation,
which was still gated at C-C-C, is now covered by the narrow internal read-query
gate above; it adds no HTTP or operational activation.
The informational R3 CREATE snapshot/payload and servicing abort-authorization
follow-ups are not reopened or corrected by this terminal-only unit.

Before application, rollback is confined to terminal methods/receipt helpers,
terminal DTO, terminal tests/harness extensions and this contract. Preserve
CREATE, DELIVER/RETURN and all approved foundation storage/helpers and
stock-consumer safeguards. The OPEN/CANCELLED query guard was unchanged by C-C-C;
the later CLOSED-filter gate above is an independent rollback boundary (its
explicit allowlist entry, read tests and query documentation). No production-readiness or native
review verdict is claimed.

## Physical-loan movement storage (M1; NOT OPERATIONAL)

**Storage declarations only; rollout remains OFF and migrations are unapplied.**
Additive 090700 introduces LOAN_DELIVERY and LOAN_RETURN without repurposing SALE
or sale RETURN. InventoryMovement has a nullable unique inventoryLoanEventId and
an optional one-to-one InventoryLoanEvent relation. Existing movements keep null
links: no backfill, historical rewrite or new validation of unlinked legacy rows.
The existing event/operation append-only protections remain unchanged.

### Linked evidence contract

| Boundary | Declaration |
| --- | --- |
| Cardinality | One movement per immutable item event, not per aggregated product; distinct same-product items remain valid |
| Identity | INSERT binds event, item, loan, product and completed operation to the same tenant; movement actor matches event author and operation actor, not necessarily loan creator |
| Discriminators | LOAN_DELIVERY requires DELIVERED event and DELIVER operation; LOAN_RETURN requires RETURNED event and RETURN operation |
| Quantity | Positive item-event quantity becomes negative delivery or positive return movement quantity |
| Snapshots | Nonnegative previousStock/newStock; bigint subtraction must equal signed quantity without Int arithmetic overflow |
| Separation | Required event link and actor, null saleId; legacy movement types cannot acquire a loan link |
| Immutability | UPDATE rejects OLD or NEW linked/loan-type evidence, including acquisition and no-op updates; DELETE rejects linked/loan-type rows |

The restrictive event FK retains immutable linked history. The insertion guard
checks product identity/tenant, not live stock or active status. Inactive physical
returns remain possible; multiple items for one product may use intermediate
snapshots rather than each claiming the product's final live stock. Ordinary
unlinked legacy movements retain their prior insert/update/delete behavior.

### Pending writer and verification gates

M2 must write movements atomically **after** completed operations and immutable
item events, with per-item snapshots and rollback/replay guarantees. M3 owns
consumers/API integration. No writer, DTO, module, controller, HTTP activation,
frontend, report or export changes are included here. No Sale, Payment, revenue
or sales COGS entry is introduced; CURRENT_STOCK_AT_CURRENT_COST reporting remains
unchanged. This is quantity evidence, not financial recognition.

Structural Jest assertions verify schema/SQL declarations only, not PostgreSQL
trigger/FK execution, races or rollback. Fresh Prisma validation/client generation
remain pending under the blocked CLI gate; existing client metadata is not proof
of this new schema. Independent verification and authorized isolated PostgreSQL
proof remain required. Before application, rollback is this schema link/reverse
relation and enum pair, 090700, its declaration tests and this documentation;
retain frozen 090400/090500/090600 and existing service/reservation safeguards.
After population, require a separately approved data-safe rollback plan.

## Verification and next slice

Run the focused suite from `backend`:

```text
node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath src/loans/inventory-loans.service.spec.ts
```

Use locally installed Prisma for generation and schema-only validation; validation
uses temporary credential-free `postgresql://localhost/schema_validation` with the
previous environment restored in `finally`; block dotenv loading, including the
config import, so no real environment file is read. Run direct
`node node_modules/typescript/bin/tsc -p tsconfig.build.json --incremental false`
and read-only ESLint with explicitly enumerated loan TypeScript files, never
backend auto-fix lint or database tests without authorization. This is not the
npm production build (whose prebuild hook loads a production environment file).

Mocked unit tests check transaction-client use and failure propagation; they do
**not** prove PostgreSQL rollback, trigger execution or runtime migration success.
Before deployment, apply the migration only in an explicitly authorized test
environment and verify real rollback on event/audit failure, constraints and
append-only enforcement. No migration execution is authorized by this unit.

L7 still requires explicitly authorized isolated PostgreSQL proof: migration
application, append-only/identity triggers, tenant/reversal FKs, atomic rollback
and real concurrent collection/reversal/closure races. Mock CAS/isolation assertions
are not runtime concurrency proof. List/detail currently load each selected loan's
ledger to compute exact totals; very large histories may need a later bounded
aggregation design without dropping history correctness.

L3C-B now includes unwired creation/read/history and mocked replay checks;
L3C-C still gates operational inventory loans. L4–L6 own POS integration and the
frontend. No existing sales or expense report includes loans.
