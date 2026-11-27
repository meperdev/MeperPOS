#!/usr/bin/env bash
#
# Multisedes upgrade rehearsal — baseline chain, legacy data, HEAD chain, checks.
#
# Proves the shipped migration chain upgrades a real pre-feature database
# without moving existing balances or widening anyone's site access. It is a
# dry run: run it against a fresh, empty, disposable database before deploying.
#
#   1. Deploys the BASELINE migration chain extracted from `origin/master`
#      (`git archive`, into a temporary directory) against the target database.
#   2. Inserts legacy rows by SQL: two organizations, products that carry
#      stock/reservedStock (including zero and a service), one membership per
#      organization role, and one open inventory-loan reservation.
#   3. Checksums Product(id, stock, reservedStock) and the memberships.
#   4. Deploys the HEAD chain from this worktree.
#   5. Asserts: Product unchanged; exactly one default-site ProductStock row per
#      product, equal to Product; operational memberships hold exactly the
#      principal grant and OWNER/ADMIN hold none; every Location is a STORE;
#      every migration finished.
#
# Usage:
#   backend/test/migrations/multisedes-upgrade.rehearse.sh \
#     'postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_release_upgrade?schema=public'
#
#   BASELINE_REF=origin/master   optional, the pre-feature commit to start from
#   PRODUCTION_LINEAGE=1         optional, start from the state production holds:
#                                after the baseline, replay the abandoned
#                                location lineage (test/migrations/fixtures/
#                                abandoned-location-lineage) and the two
#                                rolled-back attempts of the multi-site chain,
#                                so the rehearsal proves
#                                20261118115900_retire_abandoned_location_lineage
#                                clears them. Use BASELINE_REF=257218d with it.
#
# The target must be an explicitly named `meperpos_stock_rehearsal_release*`
# database on a port other than 5432. The script never drops, truncates or
# rewrites anything, and it keeps its temporary extraction directory (printed at
# the end) as evidence.
set -euo pipefail

readonly DB_NAME_PATTERN='^meperpos_stock_rehearsal_release[a-z0-9_]*$'
readonly RUNBOOK_DOC='docs/planes/implementacion/multisede-corte-stock.md'

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage 0; fi
if [[ $# -ne 1 ]]; then usage 1; fi

readonly TARGET_URL="$1"

# ---------------------------------------------------------------------------
# Target guard: only an explicitly named disposable database.
# ---------------------------------------------------------------------------
if [[ ! "${TARGET_URL}" =~ ^postgres(ql)?://([^/@]+@)?([^/:]+):([0-9]+)/([A-Za-z0-9_]+)(\?[^[:space:]]*)?$ ]]; then
  fail "expected a postgres URL with host, port, database and optional query, got: ${TARGET_URL}"
fi
readonly DB_HOST="${BASH_REMATCH[3]}"
readonly DB_PORT="${BASH_REMATCH[4]}"
readonly DB_NAME="${BASH_REMATCH[5]}"

if [[ "${DB_PORT}" == "5432" ]]; then
  fail "refusing port 5432 (the development database); use the disposable rehearsal port"
fi
if [[ ! "${DB_NAME}" =~ ${DB_NAME_PATTERN} ]]; then
  fail "refusing database '${DB_NAME}': it must match ${DB_NAME_PATTERN}"
fi
if [[ "${TARGET_URL}" != *"?schema=public"* ]]; then
  fail "refusing a URL without ?schema=public; Prisma must target the public schema"
fi

# psql does not accept Prisma's `?schema=` query parameter.
readonly PSQL_URL="${TARGET_URL%%\?*}"

# ---------------------------------------------------------------------------
# Locations and tools.
# ---------------------------------------------------------------------------
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
readonly PRISMA_BIN="${ROOT}/backend/node_modules/.bin/prisma"
readonly BASELINE_REF="${BASELINE_REF:-origin/master}"
readonly PRODUCTION_LINEAGE="${PRODUCTION_LINEAGE:-0}"
readonly LINEAGE_FIXTURES="${SCRIPT_DIR}/fixtures/abandoned-location-lineage"
readonly WORK="$(mktemp -d "${TMPDIR:-/tmp}/meperpos-upgrade-rehearsal.XXXXXX")"

if [[ ! -x "${PRISMA_BIN}" ]]; then
  fail "prisma CLI not found at ${PRISMA_BIN}; run npm install in backend/"
fi
for tool in psql git tar; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is required"
done

echo "Multisedes upgrade rehearsal"
echo "  repository : ${ROOT}"
echo "  baseline   : ${BASELINE_REF}"
echo "  production lineage replay: ${PRODUCTION_LINEAGE}"
echo "  target     : ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo "  extraction : ${WORK}"
echo

q() {
  psql "${PSQL_URL}" -v ON_ERROR_STOP=1 -At -c "$1"
}

deploy() { # schema path, working directory
  local schema="$1" from="$2"
  (
    cd "${from}"
    DATABASE_URL="${TARGET_URL}" PRISMA_HIDE_UPDATE_MESSAGE=1 \
      "${PRISMA_BIN}" migrate deploy --schema "${schema}"
  ) >/dev/null || fail "prisma migrate deploy failed for ${schema}"
}

# ---------------------------------------------------------------------------
# 0. The rehearsal needs a virgin database.
# ---------------------------------------------------------------------------
echo "[0/5] Checking the target is empty"
if [[ "$(q "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" == "t" ]]; then
  fail "database ${DB_NAME} already has a Prisma migration history; create a fresh empty meperpos_stock_rehearsal_release* database for the rehearsal"
fi
echo "  ✓ no migration history"

# ---------------------------------------------------------------------------
# 1. Baseline chain.
# ---------------------------------------------------------------------------
echo "[1/5] Deploying the baseline chain from ${BASELINE_REF}"
git -C "${ROOT}" rev-parse --verify --quiet "${BASELINE_REF}" >/dev/null ||
  fail "baseline ref ${BASELINE_REF} does not exist; fetch it or pass BASELINE_REF"
git -C "${ROOT}" archive "${BASELINE_REF}" backend/prisma | tar -x -C "${WORK}" ||
  fail "could not extract backend/prisma from ${BASELINE_REF}"
readonly BASELINE_SCHEMA="${WORK}/backend/prisma/schema.prisma"
if [[ ! -f "${BASELINE_SCHEMA}" ]]; then
  fail "baseline schema missing at ${BASELINE_SCHEMA}"
fi
# Run from the extraction directory: a `prisma.config.ts` in the working
# directory overrides `--schema`, and the worktree's config pins the HEAD
# schema and migrations.
deploy "${BASELINE_SCHEMA}" "${WORK}"
echo "  ✓ baseline applied: $(q 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL') migrations"

if [[ "${PRODUCTION_LINEAGE}" == "1" ]]; then
  # Production also carries the abandoned location lineage (applied by a local
  # deploy on 2026-11-22) and two rolled-back attempts of the multi-site chain
  # (the 2026-11-27 incident). Replay both, recorded exactly like there.
  [[ -d "${LINEAGE_FIXTURES}" ]] || fail "lineage fixtures missing at ${LINEAGE_FIXTURES}"
  cp -R "${LINEAGE_FIXTURES}/"2026* "${WORK}/backend/prisma/migrations/" ||
    fail "could not stage the abandoned lineage"
  deploy "${BASELINE_SCHEMA}" "${WORK}"
  q "INSERT INTO \"_prisma_migrations\" (id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count)
     VALUES
       (gen_random_uuid()::text, '43c60885bedc886824752aa4f3d1db6db82370be3b891ef0abe7af0ec1fdfa78', '20261118120000_initial_organization_location', now() - interval '2 minutes', NULL, now() - interval '1 minute', 0),
       (gen_random_uuid()::text, '43c60885bedc886824752aa4f3d1db6db82370be3b891ef0abe7af0ec1fdfa78', '20261118120000_initial_organization_location', now() - interval '1 minute', NULL, now(), 0)" >/dev/null ||
    fail "could not record the rolled-back attempts"
  echo "  ✓ abandoned lineage replayed: Location=$(q "SELECT to_regclass('public.\"Location\"') IS NOT NULL"), LocationAssignment=$(q "SELECT to_regclass('public.\"LocationAssignment\"') IS NOT NULL"), rolled-back attempts=$(q "SELECT count(*) FROM \"_prisma_migrations\" WHERE rolled_back_at IS NOT NULL")"
fi

# ---------------------------------------------------------------------------
# 2. Legacy data, by SQL, exactly as a pre-feature installation holds it.
# ---------------------------------------------------------------------------
echo "[2/5] Inserting legacy rows"
psql "${PSQL_URL}" -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || fail "legacy fixture insert failed"
BEGIN;

INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES
  ('release-org-a', 'Rehearsal Org A', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-org-b', 'Rehearsal Org B', 'release-org-b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "User" ("id", "email", "password", "name", "createdAt", "updatedAt")
VALUES
  ('release-user-a-owner',     'release-a-owner@example.test',     'not-a-credential', 'A owner',     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-user-a-admin',     'release-a-admin@example.test',     'not-a-credential', 'A admin',     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-user-a-member',    'release-a-member@example.test',    'not-a-credential', 'A member',    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-user-a-cashier',   'release-a-cashier@example.test',   'not-a-credential', 'A cashier',   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-user-a-inventory', 'release-a-inventory@example.test', 'not-a-credential', 'A inventory', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-user-b-owner',     'release-b-owner@example.test',     'not-a-credential', 'B owner',     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-user-b-cashier',   'release-b-cashier@example.test',   'not-a-credential', 'B cashier',   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "OrganizationUser" ("id", "userId", "organizationId", "role", "joinedAt")
VALUES
  ('release-m-a-owner',     'release-user-a-owner',     'release-org-a', 'OWNER',          CURRENT_TIMESTAMP),
  ('release-m-a-admin',     'release-user-a-admin',     'release-org-a', 'ADMIN',          CURRENT_TIMESTAMP),
  ('release-m-a-member',    'release-user-a-member',    'release-org-a', 'MEMBER',         CURRENT_TIMESTAMP),
  ('release-m-a-cashier',   'release-user-a-cashier',   'release-org-a', 'CASHIER',        CURRENT_TIMESTAMP),
  ('release-m-a-inventory', 'release-user-a-inventory', 'release-org-a', 'INVENTORY_USER', CURRENT_TIMESTAMP),
  ('release-m-b-owner',     'release-user-b-owner',     'release-org-b', 'OWNER',          CURRENT_TIMESTAMP),
  ('release-m-b-cashier',   'release-user-b-cashier',   'release-org-b', 'CASHIER',        CURRENT_TIMESTAMP)
ON CONFLICT ("userId", "organizationId") DO NOTHING;

INSERT INTO "Category" ("id", "name", "organizationId", "createdAt", "updatedAt")
VALUES
  ('release-cat-a', 'Rehearsal A', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-cat-b', 'Rehearsal B', 'release-org-b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Balances the feature must copy, never rewrite: a positive balance with a
-- reservation, a zero balance, a service that carries no stock, an inactive
-- product and a negative legacy balance. The open loan below accounts for the
-- 3 reserved units of release-p-a-stock; the other reservations are legacy
-- ledger values the upgrade copies as they are (T9's rehearsal owns whether a
-- legacy reservation ledger reconciles).
INSERT INTO "Product"
  ("id", "name", "sku", "costPrice", "salePrice", "taxRate", "stock", "reservedStock",
   "type", "tracksStock", "active", "categoryId", "organizationId", "createdAt", "updatedAt")
VALUES
  ('release-p-a-stock',    'A stocked',    'release-a-stock',    10.00, 20.00, 0.00, 13, 3, 'PRODUCT', true,  true,  'release-cat-a', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-p-a-zero',     'A zero',       'release-a-zero',     10.00, 20.00, 0.00,  0, 0, 'PRODUCT', true,  true,  'release-cat-a', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-p-a-service',  'A service',    'release-a-service',  10.00, 20.00, 0.00,  0, 0, 'SERVICE', false, true,  'release-cat-a', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-p-a-inactive', 'A inactive',   'release-a-inactive', 10.00, 20.00, 0.00,  7, 0, 'PRODUCT', true,  false, 'release-cat-a', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-p-b-stock',    'B stocked',    'release-b-stock',    10.00, 20.00, 0.00,  5, 2, 'PRODUCT', true,  true,  'release-cat-b', 'release-org-b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('release-p-b-zero',     'B zero',       'release-b-zero',     10.00, 20.00, 0.00,  0, 0, 'PRODUCT', true,  true,  'release-cat-b', 'release-org-b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Customer"
  ("id", "name", "documentType", "documentNumber", "organizationId", "createdAt", "updatedAt")
VALUES
  ('release-customer-a', 'Rehearsal customer', 'CC', '900000001', 'release-org-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "InventoryLoan" ("id", "organizationId", "status", "customerId", "createdById", "createdAt")
VALUES ('release-loan-open', 'release-org-a', 'OPEN', 'release-customer-a', 'release-user-a-owner', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "InventoryLoanItem"
  ("id", "loanId", "organizationId", "productId", "quantity", "deliveredQuantity",
   "returnedQuantity", "cancelledQuantity", "createdAt")
VALUES
  ('release-loan-open-item', 'release-loan-open', 'release-org-a', 'release-p-a-stock', 3, 0, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

COMMIT;
SQL
echo "  ✓ legacy rows inserted (open inventory-loan reservation: $(q "SELECT count(*) FROM \"InventoryLoan\" WHERE \"id\" = 'release-loan-open'"))"

# ---------------------------------------------------------------------------
# 3. Checksums of what the upgrade must leave untouched.
# ---------------------------------------------------------------------------
echo "[3/5] Recording pre-upgrade checksums"
readonly PRODUCT_CHECKSUM_SQL=$(cat <<'SQL'
SELECT md5(string_agg(concat_ws(':', "id", "stock"::text, "reservedStock"::text), ',' ORDER BY "id")) FROM "Product"
SQL
)
readonly MEMBERSHIP_CHECKSUM_SQL=$(cat <<'SQL'
SELECT md5(string_agg(concat_ws(':', "id", "userId", "organizationId", "role"::text), ',' ORDER BY "id")) FROM "OrganizationUser"
SQL
)
readonly PRODUCT_SNAPSHOT_SQL=$(cat <<'SQL'
SELECT "id", "stock", "reservedStock" FROM "Product" ORDER BY "id"
SQL
)
readonly PRODUCT_CHECKSUM_BEFORE="$(q "${PRODUCT_CHECKSUM_SQL}")"
readonly MEMBERSHIP_CHECKSUM_BEFORE="$(q "${MEMBERSHIP_CHECKSUM_SQL}")"
psql "${PSQL_URL}" -v ON_ERROR_STOP=1 -At -F '|' -c "${PRODUCT_SNAPSHOT_SQL}" \
  > "${WORK}/product-before.tsv" || fail "could not snapshot Product"
echo "  product    ${PRODUCT_CHECKSUM_BEFORE}"
echo "  membership ${MEMBERSHIP_CHECKSUM_BEFORE}"

# ---------------------------------------------------------------------------
# 4. HEAD chain.
# ---------------------------------------------------------------------------
echo "[4/5] Deploying the HEAD chain from the worktree"
readonly HEAD_SCHEMA="${ROOT}/backend/prisma/schema.prisma"
if [[ ! -f "${HEAD_SCHEMA}" ]]; then
  fail "HEAD schema missing at ${HEAD_SCHEMA}"
fi
deploy "${HEAD_SCHEMA}" "${ROOT}/backend"
echo "  ✓ head applied: $(q 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL') migrations"

# ---------------------------------------------------------------------------
# 5. Assertions. Every mismatch is reported; the exit code is non-zero if any.
# ---------------------------------------------------------------------------
echo "[5/5] Asserting the upgraded database"
FAILED=0

check() { # label, expected, actual
  local label="$1" expected="$2" actual="$3"
  if [[ "${actual}" == "${expected}" ]]; then
    echo "  ✓ ${label}"
  else
    echo "  ✗ ${label}: expected '${expected}', found '${actual}'" >&2
    FAILED=1
  fi
}

readonly PRODUCT_CHECKSUM_AFTER="$(q "${PRODUCT_CHECKSUM_SQL}")"
readonly MEMBERSHIP_CHECKSUM_AFTER="$(q "${MEMBERSHIP_CHECKSUM_SQL}")"

if [[ "${PRODUCT_CHECKSUM_AFTER}" == "${PRODUCT_CHECKSUM_BEFORE}" ]]; then
  echo "  ✓ Product(id, stock, reservedStock) unchanged"
else
  echo "  ✗ Product(id, stock, reservedStock) changed during the upgrade" >&2
  psql "${PSQL_URL}" -v ON_ERROR_STOP=1 -At -F '|' -c "${PRODUCT_SNAPSHOT_SQL}" \
    > "${WORK}/product-after.tsv" || true
  diff -u "${WORK}/product-before.tsv" "${WORK}/product-after.tsv" >&2 || true
  FAILED=1
fi
check "OrganizationUser rows unchanged" "${MEMBERSHIP_CHECKSUM_BEFORE}" "${MEMBERSHIP_CHECKSUM_AFTER}"

readonly DEFAULT_BALANCE_MISMATCH_SQL=$(cat <<'SQL'
SELECT count(*)
FROM "Product" p
LEFT JOIN "Location" l
  ON l."organizationId" = p."organizationId" AND l."isDefault"
LEFT JOIN "ProductStock" ps
  ON ps."productId" = p."id" AND ps."locationId" = l."id"
WHERE l."id" IS NULL
   OR ps."productId" IS NULL
   OR ps."stock" <> p."stock"
   OR ps."reservedStock" <> p."reservedStock"
SQL
)
readonly SECOND_BALANCE_SQL=$(cat <<'SQL'
SELECT count(*) FROM (
  SELECT "productId" FROM "ProductStock" GROUP BY "productId" HAVING count(*) <> 1
) extra
SQL
)
readonly WAREHOUSE_SQL=$(cat <<'SQL'
SELECT count(*) FROM "Location" WHERE "type" <> 'STORE'
SQL
)
readonly PRINCIPAL_SQL=$(cat <<'SQL'
SELECT count(*) FROM (
  SELECT "organizationId" FROM "Location"
  GROUP BY "organizationId"
  HAVING count(*) FILTER (WHERE "isDefault") <> 1
) broken
SQL
)
readonly OPERATIONAL_GRANTS_SQL=$(cat <<'SQL'
SELECT count(*) FROM (
  SELECT m."userId", m."organizationId",
         (SELECT count(*) FROM "MembershipLocation" g
           WHERE g."userId" = m."userId" AND g."organizationId" = m."organizationId") AS grants,
         (SELECT count(*) FROM "MembershipLocation" g
            JOIN "Location" l ON l."id" = g."locationId" AND l."isDefault"
           WHERE g."userId" = m."userId" AND g."organizationId" = m."organizationId") AS principal_grants
  FROM "OrganizationUser" m
  WHERE m."role" IN ('CASHIER', 'MEMBER', 'INVENTORY_USER')
) operational
WHERE grants <> 1 OR principal_grants <> 1
SQL
)
readonly ORG_WIDE_GRANTS_SQL=$(cat <<'SQL'
SELECT count(*)
FROM "OrganizationUser" m
WHERE m."role" IN ('OWNER', 'ADMIN')
  AND EXISTS (
    SELECT 1 FROM "MembershipLocation" g
    WHERE g."userId" = m."userId" AND g."organizationId" = m."organizationId"
  )
SQL
)
readonly UNRESOLVED_FAILURES_SQL=$(cat <<'SQL'
SELECT count(*) FROM "_prisma_migrations"
WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
SQL
)
# Every migration of the worktree's chain must have a finished row.
LOCAL_MIGRATIONS="$(find "${ROOT}/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf "'%f'," | sed 's/,$//')"
readonly LOCAL_MIGRATIONS
readonly MISSING_LOCAL_SQL="SELECT count(*) FROM unnest(ARRAY[${LOCAL_MIGRATIONS}]::text[]) AS m(name)
WHERE NOT EXISTS (SELECT 1 FROM \"_prisma_migrations\" p
                  WHERE p.migration_name = m.name AND p.finished_at IS NOT NULL AND p.rolled_back_at IS NULL)"

# Exactly one default-site row per product, equal to the aggregate.
check "every product has exactly one matching default-site balance" "0" "$(q "${DEFAULT_BALANCE_MISMATCH_SQL}")"
check "site balances equal products (one row each)" "$(q 'SELECT count(*) FROM "Product"')" "$(q 'SELECT count(*) FROM "ProductStock"')"
check "no product holds a second site balance" "0" "$(q "${SECOND_BALANCE_SQL}")"

# Every location is a store, and each organization keeps exactly one principal.
check "no location was created as a warehouse" "0" "$(q "${WAREHOUSE_SQL}")"
check "each organization has exactly one principal site" "0" "$(q "${PRINCIPAL_SQL}")"

# Operational memberships hold exactly the principal grant; owners and
# administrators hold none (their access comes from the role).
check "operational memberships hold exactly the principal grant" "0" "$(q "${OPERATIONAL_GRANTS_SQL}")"
check "owners and administrators hold no site grant" "0" "$(q "${ORG_WIDE_GRANTS_SQL}")"

# The whole chain finished: no unresolved failure and every local migration applied.
check "no migration is left failed" "0" "$(q "${UNRESOLVED_FAILURES_SQL}")"
check "every migration of the chain finished" "0" "$(q "${MISSING_LOCAL_SQL}")"

if [[ "${PRODUCTION_LINEAGE}" == "1" ]]; then
  check "the abandoned LocationAssignment table is gone" "" "$(q "SELECT to_regclass('public.\"LocationAssignment\"')")"
  check "the abandoned triggers are gone" "0" "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN ('Organization_default_location', 'OrganizationUser_principal_location_assignment')")"
  check "the abandoned functions are gone" "0" "$(q "SELECT count(*) FROM pg_proc WHERE proname IN ('create_default_organization_location', 'create_principal_location_assignment')")"
  check "the abandoned OrganizationUser index is gone" "" "$(q "SELECT to_regclass('public.\"OrganizationUser_id_organizationId_key\"')")"
  check "Location has the multi-site shape (address column)" "1" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name = 'Location' AND column_name = 'address'")"
fi

if [[ "${FAILED}" -ne 0 ]]; then
  cat >&2 <<EOF

The upgrade rehearsal FAILED on ${DB_NAME}.
Do not deploy this branch over ${BASELINE_REF} until the checks above pass.
See ${RUNBOOK_DOC}, "Antes de desplegar: ensayo de la migración".
Evidence kept in ${WORK}
EOF
  exit 1
fi

cat <<EOF

The upgrade rehearsal passed on ${DB_NAME}.
  baseline    ${BASELINE_REF}
  migrations  $(q 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
  product     ${PRODUCT_CHECKSUM_AFTER}
  membership  ${MEMBERSHIP_CHECKSUM_AFTER}
Evidence kept in ${WORK}
EOF
