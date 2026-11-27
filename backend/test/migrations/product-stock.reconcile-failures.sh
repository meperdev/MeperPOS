#!/usr/bin/env bash
# Read-only T9 stock reconciliation gate checks.
#
# Run it from backend/ against a disposable database whose name starts with
# meperpos_stock_rehearsal_t9_ and that already loaded product-stock.reconcile-fixture.sql.
# The connection comes from the password-free libpq environment (PGHOST, PGPORT,
# PGUSER, PGDATABASE), so no URL or password ever lands in the process arguments.
#
# Faults are committed into that disposable fixture before each run and undone
# afterwards; every rejection must leave the source, ledger, and dormant target
# unchanged. The gate is never asked to inject a fault inside its own transaction.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2

gate=test/migrations/product-stock.reconcile.sql
passed=0
failed=0
ok() { passed=$((passed + 1)); printf 'ok %d - %s\n' "$passed" "$1"; }
no() { failed=$((failed + 1)); printf 'not ok - %s\n' "$1"; }

p() { psql -X -v ON_ERROR_STOP=1 "$@" 2>&1; }

database=$(p -Atq -c 'SELECT current_database()') || {
  no 'the disposable rehearsal database is unreachable'
  printf '%d passed, %d failed\n' "$passed" "$failed"
  exit 1
}
database=${database%$'\n'}
if [[ ! $database =~ ^meperpos_stock_rehearsal_t9_[a-z0-9_]+$ ]]; then
  no "$database is not a meperpos_stock_rehearsal_t9_ database"
  printf '%d passed, %d failed\n' "$passed" "$failed"
  exit 1
fi

# Source balances, both reservation ledgers, and the dormant target, row by row.
snapshot() {
  p -Atq \
    -c 'SELECT to_jsonb(x)::text FROM "Product" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "Location" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "InventoryLoan" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "InventoryLoanItem" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "MoneyLoan" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "PosLoanSaleIntent" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "PosLoanSaleReservation" x ORDER BY "id"' \
    -c 'SELECT to_jsonb(x)::text FROM "ProductStock" x ORDER BY x."productId", x."locationId"'
}

pristine=$(snapshot) || {
  no 'the fixture snapshot cannot be read'
  printf '%d passed, %d failed\n' "$passed" "$failed"
  exit 1
}
if [[ $(p -Atq -c 'SELECT count(*) FROM "ProductStock"') != 0 ]]; then
  no 'the durable target is not empty before the rehearsal starts'
  printf '%d passed, %d failed\n' "$passed" "$failed"
  exit 1
fi

# A rejection must exit 3, match both streams, and change nothing.
rejection_stderr=$(mktemp) || exit 1
trap 'rm -f -- "$rejection_stderr"' EXIT
expect_rejection() {
  local name=$1 expected=$2 expected_stdout=$3 warning=$4
  shift 4
  local before after stdout stderr rc=0
  local expected_stderr="ERROR:  $expected"
  if [[ -n $warning ]]; then expected_stderr="$warning"$'\n'"$expected_stderr"; fi
  before=$(snapshot)
  stdout=$(psql -X -w -v ON_ERROR_STOP=1 -v VERBOSITY=terse -At "$@" -f "$gate" 2> "$rejection_stderr") || rc=$?
  # Ignore only the psql source path/line decoration, not extra diagnostics.
  stderr=$(sed -E 's@^psql:test/migrations/product-stock\.reconcile\.sql:[0-9]+: @@' "$rejection_stderr")
  after=$(snapshot)
  if [[ $rc -ne 3 ]]; then
    no "$name: exit $rc, expected 3"
    printf 'stdout:\n%s\nstderr:\n%s\n' "$stdout" "$stderr"
  elif [[ $stdout != "$expected_stdout" || $stderr != "$expected_stderr" ]]; then
    no "$name: unexpected output for \"$expected\""
    printf 'stdout:\n%s\nstderr:\n%s\n' "$stdout" "$stderr"
  elif [[ $after != "$before" ]]; then
    no "$name: the rejected rehearsal changed the database"
  else
    ok "$name"
  fi
}

# Same, with the fault committed first and the fixture restored afterwards.
inject() {
  local name=$1 expected=$2 fault=$3 restore=$4
  if ! p -Atq -c "$fault"; then
    no "$name: the fault cannot be injected"
    return
  fi
  expect_rejection "$name" "$expected" BEGIN ''
  if ! p -Atq -c "$restore"; then
    no "$name: the fixture cannot be restored"
    return
  fi
  if [[ $(snapshot) != "$pristine" ]]; then
    no "$name: the fixture state was not restored"
  fi
}

# Legal fixture: one deterministic count, no balances, no writes.
output=$(p -At -f "$gate")
rc=$?
expected_output=$'BEGIN\nDO\n7\nROLLBACK'
if [[ $rc -ne 0 ]]; then
  no "consistent fixture: exit $rc, expected 0"
  printf '%s\n' "$output"
elif [[ $output != "$expected_output" ]]; then
  no 'consistent fixture: unexpected output'
  printf '%s\n' "$output"
elif [[ $(snapshot) != "$pristine" ]]; then
  no 'consistent fixture: the accepted rehearsal changed the database'
else
  ok 'consistent fixture reports only the verified product count'
fi

# Structural proof that the gate cannot write, lock, or create objects.
if [[ ! -f $gate ]]; then
  no 'the read-only gate script is missing'
else
  statements=$(sed -e 's/--.*//' "$gate")
  if printf '%s\n' "$statements" | grep -Eiq \
    '\b(insert|update|delete|create|drop|alter|truncate|copy|grant|revoke|vacuum|analyze|into|lock)\b' \
    || printf '%s\n' "$statements" | grep -Eiq '\bfor +(no +key +|key +)?(update|share)\b' \
    || printf '%s\n' "$statements" | grep -Eiq 'pg_temp|temporary'; then
    no 'the gate contains a write, lock, or temporary-object statement'
  else
    ok 'the gate contains no write, lock, or temporary-object statement'
  fi
fi

# The rehearsal prefix is the only database family it may run against.
expect_rejection 'rejects a database outside the rehearsal prefix' \
  'Expected a disposable stock rehearsal database' BEGIN '' -d postgres

# Nested invocation. PostgreSQL applies a BEGIN's transaction characteristics even
# inside an open block, so the gate establishes its own contract; once the caller
# already ran a query it cannot, and the gate fails closed before any check.
output=$(p -At -c 'BEGIN' -f "$gate")
rc=$?
if [[ $rc -ne 0 || $output != *$'\n7\nROLLBACK' ]]; then
  no 'enforces the read contract inside a caller transaction that has not queried yet'
  printf '%s\n' "$output"
else
  ok 'enforces the read contract inside a caller transaction that has not queried yet'
fi
expect_rejection 'fails closed inside a caller transaction that already ran a query' \
  'SET TRANSACTION ISOLATION LEVEL must be called before any query' \
  $'BEGIN\n1' 'WARNING:  there is already a transaction in progress' \
  -c 'BEGIN' -c 'SELECT 1'

inject 'rejects a dormant target that is not installed' \
  'ProductStock schema must be installed before rehearsing stock' \
  'ALTER TABLE "ProductStock" RENAME TO "ProductStock_hidden"' \
  'ALTER TABLE "ProductStock_hidden" RENAME TO "ProductStock"'

inject 'rejects a dormant target that already holds rows' \
  'ProductStock must be empty before rehearsing stock' \
  'INSERT INTO "ProductStock" ("productId", "locationId", "organizationId", "stock", "reservedStock")
   VALUES ($id$t9-a5$id$, $id$t9-a-main$id$, $id$t9-a$id$, 6, 0)' \
  'DELETE FROM "ProductStock" WHERE "productId" = $id$t9-a5$id$'

# Organization A keeps its default: only B loses it, so a foreign default cannot rescue B.
inject 'rejects a product without a default location in its own organization' \
  'At least one product has no default location in its organization' \
  'UPDATE "Location" SET "isDefault" = false WHERE "id" = $id$t9-b-main$id$' \
  'UPDATE "Location" SET "isDefault" = true WHERE "id" = $id$t9-b-main$id$'

inject 'rejects negative legacy stock' \
  'Product stock is negative before the cutover' \
  'UPDATE "Product" SET "stock" = -1 WHERE "id" = $id$t9-a2$id$' \
  'UPDATE "Product" SET "stock" = 0 WHERE "id" = $id$t9-a2$id$'

# The database itself refuses these states, so the gate keeps them as defense in depth.
# Every attempted injection is rolled back by PostgreSQL, not by the harness.
precluded() {
  local name=$1 constraint=$2 fault=$3
  local before after output rc=0
  before=$(snapshot)
  output=$(p -Atq -c "$fault")
  rc=$?
  after=$(snapshot)
  if [[ $rc -eq 0 ]]; then
    no "$name: the database accepted the state"
  elif [[ $'\n'$output$'\n' != *$'\n'"ERROR:  new row for relation \"Product\" violates check constraint \"$constraint\""$'\n'* ]]; then
    no "$name: unexpected preclusion diagnostic"
    printf '%s\n' "$output"
  elif [[ $after != "$before" ]]; then
    no "$name: the refused fault changed the database"
  else
    ok "$name"
  fi
}

precluded 'precluded: a negative reservation cannot exist' \
  'Product_reservedStock_bounds_check' \
  'UPDATE "Product" SET "reservedStock" = -1 WHERE "id" = $id$t9-a2$id$'
precluded 'precluded: a reservation above the available stock cannot exist' \
  'Product_reservedStock_bounds_check' \
  'UPDATE "Product" SET "reservedStock" = 1 WHERE "id" = $id$t9-a2$id$'
precluded 'precluded: an inactive product cannot hold reservations' \
  'Product_reservedStock_eligibility_check' \
  'UPDATE "Product" SET "active" = false WHERE "id" = $id$t9-a1$id$'
precluded 'precluded: a non-inventory product cannot hold reservations' \
  'Product_reservedStock_eligibility_check' \
  'UPDATE "Product" SET "type" = $id$SERVICE$id$, "tracksStock" = false WHERE "id" = $id$t9-a1$id$'

# Counters agree with an open-loan-only ledger here, but the terminal loan is stuck.
inject 'rejects a terminal inventory loan that still holds quantities' \
  'Terminal inventory loans still hold reserved quantities' \
  'UPDATE "InventoryLoan" SET "status" = $id$CANCELLED$id$ WHERE "id" = $id$t9-loan-a1$id$;
   UPDATE "Product" SET "reservedStock" = 3 WHERE "id" = $id$t9-a1$id$' \
  'UPDATE "InventoryLoan" SET "status" = $id$OPEN$id$ WHERE "id" = $id$t9-loan-a1$id$;
   UPDATE "Product" SET "reservedStock" = 7 WHERE "id" = $id$t9-a1$id$'

# The stored counter still equals the HELD total, so only the stuck hold itself fails.
inject 'rejects a held POS reservation on a finalized intent' \
  'POS reservations are still held on a finalized intent' \
  'UPDATE "MoneyLoan" SET "status" = $id$CANCELLED$id$ WHERE "id" = $id$t9-money-b2$id$' \
  'UPDATE "MoneyLoan" SET "status" = $id$OPEN$id$ WHERE "id" = $id$t9-money-b2$id$'

# Two compensating errors inside organization A keep the organization total intact.
inject 'rejects a per-product mismatch hidden by the organization total' \
  'Reserved stock does not match the loan and POS reservation ledger' \
  'UPDATE "Product" SET "reservedStock" = 6 WHERE "id" = $id$t9-a1$id$;
   UPDATE "Product" SET "reservedStock" = 1 WHERE "id" = $id$t9-a5$id$' \
  'UPDATE "Product" SET "reservedStock" = 7 WHERE "id" = $id$t9-a1$id$;
   UPDATE "Product" SET "reservedStock" = 0 WHERE "id" = $id$t9-a5$id$'

inject 'rejects an overstated reservation for one product' \
  'Reserved stock does not match the loan and POS reservation ledger' \
  'UPDATE "Product" SET "reservedStock" = 8 WHERE "id" = $id$t9-a1$id$' \
  'UPDATE "Product" SET "reservedStock" = 7 WHERE "id" = $id$t9-a1$id$'

inject 'rejects an understated reservation for one product' \
  'Reserved stock does not match the loan and POS reservation ledger' \
  'UPDATE "Product" SET "reservedStock" = 1 WHERE "id" = $id$t9-b2$id$' \
  'UPDATE "Product" SET "reservedStock" = 2 WHERE "id" = $id$t9-b2$id$'

inject 'rejects a reservation no ledger row backs' \
  'Reserved stock does not match the loan and POS reservation ledger' \
  'UPDATE "Product" SET "reservedStock" = 3 WHERE "id" = $id$t9-a5$id$' \
  'UPDATE "Product" SET "reservedStock" = 0 WHERE "id" = $id$t9-a5$id$'

# Genuine legacy exception: the database tolerates negative stock, so a negative
# balance whose counters fully agree with both ledgers is a real state the gate
# must still refuse instead of trusting the counters.
inject 'rejects a legacy negative balance whose counters agree' \
  'Product stock is negative before the cutover' \
  'UPDATE "Product" SET "stock" = -3 WHERE "id" = $id$t9-a1$id$' \
  'UPDATE "Product" SET "stock" = 12 WHERE "id" = $id$t9-a1$id$'

if [[ $(p -At -f "$gate") != $'BEGIN\nDO\n7\nROLLBACK' ]]; then
  no 'the fixture did not return to its accepted state'
else
  ok 'the fixture returns to its accepted state'
fi

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ $failed -eq 0 ]]
