# SuperAdmin modules: enable capabilities per organization

Modules are platform capabilities that one organization can use and another can do without — for example, vehicle plates for a motorcycle shop but not for a cosmetics distributor. Only the platform SuperAdmin changes that state. This guide covers the SuperAdmin **Módulos** section, the per-module organization screen, and the read-only summary shown on an organization's detail page.

## Who can administer

- **SUPER_ADMIN only.** Every administrative module route is guarded on the backend by `JwtAuthGuard` + `RolesGuard` with `@Roles('SUPER_ADMIN')`. A hidden menu or a redirect is presentation, not a permission.
- An organization's `OWNER` or `ADMIN` works inside the capability the platform enabled; they cannot enable or disable a module for their tenant.
- Plans, roles and modules are separate decisions. Changing an organization's plan does not activate a module, and no organization role grants module activation.
- The organization detail page shows module state but has no activation control: activation happens in one place only.

## Quick path

1. Sign in as SuperAdmin and open **Módulos** in the admin navigation. It sits next to **Panel** and **Organizaciones**.
2. Pick the module. **Vehículos** is the only implemented module today.
3. Search organizations by name or slug, and filter by module state: **Todos**, **Activados** or **Desactivados**.
4. Use **Activar** or **Desactivar** on the organization's row. The list and the organization cache refresh from the server answer.
5. Open an organization's detail page to confirm the result. Its **Módulos** card is a summary: the module name, an **Activo**/**Inactivo** badge, and a link to `/admin/modules/<moduleId>`.

Expected result: the organization list and the organization detail agree on the same server-reported state, and the only activation controls are on the module detail screen.

## What exists today

| Area | State |
| --- | --- |
| Module catalog | Served by the backend. Today it contains `vehicles` only. |
| Vehicles capability | Implemented: customer vehicle records, legacy plate compatibility and existing module gating. |
| Suggested modules (employees, payroll, expenses, reports, and similar) | **Not implemented.** Do not add placeholder entries to the catalog or the UI. |
| Per-module screen | `/admin/modules/<moduleId>`; `/admin/modules/vehicles` is the real detail page. |
| Organization detail | Read-only linked summary, no duplicated controls. |

The client renders the catalog the server returns. It does not hardcode module names, invent entries or derive enabled state locally.

## API surface

All routes are under `/api`, use the existing cookie session, and keep the existing role guard as the authority.

| Route | Method | Who | Result |
| --- | --- | --- | --- |
| `/api/admin/modules` | GET | SUPER_ADMIN | Global catalog: `id`, `name`, `description` |
| `/api/admin/organizations` | GET | SUPER_ADMIN | Organizations, each with `enabledModules` from one bulk read |
| `/api/admin/organizations/:organizationId/modules` | GET | SUPER_ADMIN | Authoritative module state for that organization |
| `/api/admin/organizations/:organizationId/modules/:moduleId` | PATCH | SUPER_ADMIN | Body `{ "enabled": boolean }`; the server rejects an unknown module id |
| `/api/business-modules` | GET | Any authenticated user with an organization scope | The caller's own organization module state |

The module detail searches the organization list already loaded for the admin section; it does not add a per-keystroke server query. The state filter uses each organization's `enabledModules`: when the server did not answer for that tenant, the organization is neither **Activado** nor **Desactivado**, so only **Todos** can show it.

The `PATCH` body accepts only one JSON boolean, `{ "enabled": true }` or `{ "enabled": false }`; a string such as `"false"`, a number, `null`, an object, an array or a missing `enabled` answers the standard 400 validation error and changes nothing.

## State and data preservation

- Disabling a module writes `enabled: false` for that organization and module. It does not delete the module row, the organization, or the capability's domain data.
- Re-enabling the same module restores access to the preserved data; customer vehicles and their legacy plate values are not removed by a module toggle.
- The server owns the state; refresh the affected organization after a toggle instead of trusting an optimistic local copy.
- This administration UI adds no schema changes and requires the existing business-module foundation schema. Applying or validating that schema in a deployment is a separate operation; this work does not run migrations, seed or reset.

## Boundaries

- Backend authorization is the real boundary. Frontend navigation and redirects only help a user find the permitted screen.
- One control surface per piece of state: activation is on `/admin/modules/<moduleId>`; the organization detail links there instead of rendering a second set of buttons.
- The catalog is the source of truth. Adding a module to the backend catalog is what makes it administrable; no UI list needs to be edited separately.
- This guide describes the implemented flow. Whole-feature and browser end-to-end verification are tracked separately from this documentation change.
