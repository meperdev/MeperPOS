---
date: 2026-11-27
layer: "01+02"
title: The team screen's edit dialog sent `role`, so every user edit failed with 400
source: "Found while retiring the MEMBER role (architecture/roles-redesign)"
pr:
paths:
  - frontend/src/hooks/useUsers.ts
tests:
  - frontend/src/components/users/UsersManagementPage.test.tsx
---

The "Editar usuario" dialog had a "Rol" select and submitted its whole form,
`{ name, email, role }`, to `PUT /users/:id`. `UpdateUserDto` has no `role`
field and the global `ValidationPipe` runs with `forbidNonWhitelisted`, so the
API answered `400 property role should not exist` to every edit, even a
name-only one. The frontend type allowed it because `UpdateUserPayload` carried
an optional `role`, and the test mocked `useUpdateUser` without ever submitting
an edit. A code comment even assumed the server ignored the role.

`UpdateUserPayload` now holds only `name` and `email`, so sending a role in an
edit no longer type-checks (01). The dialog drops the select, since no endpoint
changes a role yet. The new test submits a rename and asserts the request is
exactly `{ name, email }` and that the dialog has no "Rol" field: it failed
before the change and passes after (02). The same suite's password-reveal test
now waits for the dialog's initial focus before typing; it raced the Modal's
`requestAnimationFrame` focus and sent the keystrokes into "Nombre" when a test
ran before it.
