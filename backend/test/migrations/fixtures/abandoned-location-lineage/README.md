# Abandoned location lineage (fixture)

Verbatim copies of the two migrations from the unmerged `feat/multisedes`
branch that were applied to production on 2026-11-22 with a local
`prisma migrate deploy`:

- `20261120120000_add_location_foundation`
- `20261120130000_add_location_assignments`

They are **not** part of the migration chain. `multisedes-upgrade.rehearse.sh`
replays them on top of the baseline when `PRODUCTION_LINEAGE=1`, so the
rehearsal starts from the state production really has, and
`20261118115900_retire_abandoned_location_lineage` must retire them before the
multi-site chain applies. See `odd/tasks/multisedes.md` (L125) and
`docs/planes/implementacion/multisede-corte-stock.md`.
