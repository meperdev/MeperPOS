---
date: 2026-11-27
layer: "02"
title: Any ADMIN could edit or deactivate the primary owner and other admins
source: "Roles redesign follow-up (odd/tasks/roles-redesign.md L25)"
pr:
paths:
  - backend/src/users/users.service.ts
tests:
  - backend/src/users/users.service.spec.ts
  - backend/src/users/users.privilege-escalation.int.spec.ts
---

`PUT /users/:id` and `PUT /users/:id/toggle-active` require only ADMIN, and
`UsersService.update` / `toggleActive` checked nothing about the target. After
OWNER was folded into ADMIN, any ordinary ADMIN could change the primary
owner's name or email (locking them out of their login) or deactivate them,
and do the same to every other admin. Password resets were already protected,
but by a check that lived only inside `resetPassword`.

That check is now `assertMayManageAdminAccount`, shared by reset, edit and
deactivate: an admin-rank account (ADMIN, or a leftover OWNER) and the primary
owner's account are managed only by the primary owner or a SUPER_ADMIN; acting
on one's own account is allowed, and a missing actor is never let through. The
controller now passes the actor to `update` and `toggleActive`. Unit tests pin
each refusal and each allowed case, including a leftover OWNER and a missing
actor; a PostgreSQL integration test proves an ordinary ADMIN gets
403 and the owner's email and active flag stay unchanged. It failed before the
change and passes after.
