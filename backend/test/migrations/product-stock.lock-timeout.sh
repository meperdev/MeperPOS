#!/usr/bin/env bash
set -euo pipefail
export PGOPTIONS='-c statement_timeout=0 -c lock_timeout=0'
p() { psql -X -v ON_ERROR_STOP=1 "${TEST_DATABASE_URL:?}" "$@"; }
location_index_state() {
  p -Atc 'SELECT oid::text || $q$|$q$ || pg_get_indexdef(oid)
    FROM pg_class WHERE oid = to_regclass($q$"Location_id_organizationId_key"$q$)'
}
schema_is_unchanged() {
  [[ $(p -Atc 'SELECT to_regclass($q$"ProductStock"$q$) IS NULL') == t ]]
  # The canonical composite index comes from an earlier migration and must survive untouched.
  [[ $(location_index_state) == "$location_index_before" ]]
}
[[ $(p -Atc 'SELECT current_database()') =~ ^meperpos_stock_rehearsal_[a-z0-9_]+$ ]]
location_index_before=$(location_index_state)
[[ -n $location_index_before ]]
schema_is_unchanged

# Hold the same table lock that a transaction writing to Product acquires.
coproc holder { exec stdbuf -oL psql -X -qAt -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL"; }
holder_pid=$holder_PID
cleanup() {
  kill "$holder_pid" 2>/dev/null || true
  wait "$holder_pid" 2>/dev/null || true
}
trap cleanup EXIT
printf '%s\n' 'BEGIN; LOCK TABLE "Product" IN ROW EXCLUSIVE MODE; SELECT $$product-lock-held$$;' >&"${holder[1]}"
IFS= read -r -t 5 ready <&"${holder[0]}"
[[ $ready == product-lock-held ]]

for limit in 0 1s; do
  deadline=8s
  if [[ $limit == 1s ]]; then deadline=4s; fi
  rc=0
  output=$(PGOPTIONS="-c statement_timeout=0 -c lock_timeout=$limit" timeout "$deadline" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$TEST_DATABASE_URL" \
    -f prisma/migrations/20261119130000_product_stock_by_location/migration.sql 2>&1) || rc=$?
  printf '%s\nMigration process exit (session lock_timeout=%s): %s\n' "$output" "$limit" "$rc"
  # psql exits 3 on SQL failure; 124 means the harness timed out.
  [[ $rc == 3 && $output == *'55P03:'* ]]
  schema_is_unchanged
done
