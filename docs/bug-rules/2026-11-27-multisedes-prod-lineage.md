---
date: 2026-11-27
layer: "01+02"
title: The multi-site deploy crashed production because the upgrade rehearsal started from master, not from production's real schema
source: "Incident 2026-11-27 after merging #402 (odd/tasks/multisedes.md, L125)"
pr:
paths:
  - backend/prisma/migrations/20261118115900_retire_abandoned_location_lineage/migration.sql
  - backend/test/migrations/multisedes-upgrade.rehearse.sh
  - backend/test/migrations/multisedes-prod-precheck.sql
tests:
  - backend/test/migrations/multisedes-upgrade.rehearse.sh
  - backend/test/migrations/fixtures/abandoned-location-lineage
---

Production carried two migrations from an unmerged branch
(`20261120120000_add_location_foundation`, `20261120130000_add_location_assignments`),
applied on 2026-11-22 with a local `prisma migrate deploy`. They created a
`Location` table and a `LocationType` enum among other objects. The multi-site
chain creates both with its own shape, so the Railway deploy of #402 failed on
`20261118120000_initial_organization_location`; `start:prod` runs
`migrate deploy` before Nest, so the API crashed until the failed attempts were
marked rolled back and the previous version was redeployed. No data changed.

The upgrade rehearsal started from `origin/master`, which never had those
migrations, so it passed while production would fail.

Layer 01: `20261118115900_retire_abandoned_location_lineage` sorts before the
multi-site chain, acts only when the abandoned lineage is applied and the chain
is not, and refuses (fails closed, nothing dropped) unless every abandoned row
is one its own triggers generated.

Layer 02: the rehearsal gains `PRODUCTION_LINEAGE=1`, which replays the
abandoned lineage from byte-identical fixtures (same checksums as production)
and the two rolled-back attempts on top of `257218d`, and asserts every
abandoned object is gone. RED: without the new migration the rehearsal fails
exactly like production. GREEN: 16/16 checks. A read-only
`multisedes-prod-precheck.sql` checks production for the same conditions before
a deploy.

Process rule: rehearse a production migration from production's real
`_prisma_migrations` history (or a snapshot), never from `master` alone.
