---
date: 2026-11-27
layer: "01"
title: Membership queries still filtered by the retired OWNER role, which breaks once the enum drops it
source: "Roles redesign phase 4 verification (odd/tasks/roles-redesign.md L39)"
pr:
paths:
  - backend/src/alerts/stock-alerts.service.ts
  - backend/src/loans/inventory-loans.service.ts
  - backend/src/whatsapp/whatsapp-delivery.service.ts
tests:
  - backend/src/loans/inventory-loans.service.spec.ts
  - backend/test/migrations/multisedes-upgrade.rehearse.sh
---

Four Prisma filters (stock-alert recipients, two inventory-loan admin checks
and the WhatsApp delivery recipients) still matched `role IN ('OWNER',
'ADMIN')` after `20261127130000_collapse_owner_into_admin` moved every owner
membership to ADMIN. The results were unchanged, but Postgres rejects a
literal that is not a label of the enum, so once
`20261127200000_drop_owner_member_roles` removes OWNER any instance still
running these filters fails: during the deploy overlap, or indefinitely after
a rollout that fails past the migration.

This change makes the filters match ADMIN alone and ships before the enum
drop. The enum drop then raises the rule to layer 01: OWNER and MEMBER stop
being members of the Prisma `OrgRole` type, so TypeScript rejects any new
filter that names them, and the upgrade rehearsal pins the three labels.
