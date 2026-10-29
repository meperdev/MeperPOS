# WAHA connection (experimental)

This integration uses unofficial WhatsApp automation. It can violate WhatsApp terms, disconnect or restrict a number, and change without notice. Do not scan a production number until its owner accepts these risks and chooses a test number. This stage does not authorize senders, process messages, deliver reports, or schedule jobs.

## Configuration and isolation

Set these in the backend's secret manager, not in source control or logs:

- `WAHA_BASE_URL`: private HTTP(S) origin of the WAHA service, reachable only by trusted backend workloads.
- `WAHA_API_KEY`: private WAHA API key, identical to WAHA's configured key.
- `WAHA_WEBHOOK_HMAC_KEY`: independent high-entropy HMAC key, shared only with WAHA and the backend.
- `WAHA_WEBHOOK_URL`: full URL WAHA can reach for `POST /api/whatsapp/webhook`.

All four are required. With any missing value session operations fail closed. Restrict network access between WAHA and the backend; if traffic crosses an untrusted network use authenticated transport/TLS. Never publish WAHA's port or expose its dashboard, Swagger, API key, HMAC key, session files or QR to the public. WAHA's API key protects its API; the HMAC is a separate secret. Protect and back up the session volume as credentials. Session names are SHA-256 hashes of the authenticated organization ID, with a prefix; they are not secrets. No event-supplied tenant identifier is trusted.

`backend/docker-compose.yml` remains the PostgreSQL-only configuration and does not require WAHA variables. The separate `backend/docker-compose.waha.yml` defines WAHA with a named `/app/.sessions` volume, no published port and disabled dashboard and Swagger. Supply `WAHA_IMAGE` as a verified immutable image reference and `WAHA_API_KEY` through the deployment secret mechanism; do not put them in command arguments. From `backend/`, an explicitly approved deployment can start it with `docker compose -p meper-waha -f docker-compose.waha.yml up -d`. Do not combine this file with the PostgreSQL Compose file for the ordinary database workflow: Compose interpolates variables before profile selection. No image tag has been verified here; do not treat a release number or `latest` as a verified pin.

WAHA joins the separate `meper-waha_waha_private` bridge under the specified project name, not the database's default network. The deployment must explicitly attach the backend to that bridge and separately to its database network, provide a backend address reachable from WAHA for the webhook, and limit network membership to trusted workloads. A host-only backend is not automatically reachable from the container; establish an explicitly secured route rather than publishing WAHA. The bridge allows outbound traffic and is not encryption or a firewall; configure deployment firewall and TLS as appropriate. The project name also scopes the persistent volume: changing it or moving an existing WAHA deployment requires a planned volume migration, not an automatic copy. Docker, image availability and this topology have not been tested here.

## Operation

An organization OWNER or ADMIN can call `POST /api/whatsapp/session` to create and start its derived session, `GET /api/whatsapp/session` for status, and `GET /api/whatsapp/session/qr` for a base64 PNG in `data`. Authentication and organization scope come from the existing JWT/cookie session, not a supplied session name. Mutating cookie requests retain existing CSRF checks. QR responses are `private, no-store`; treat a QR as a login credential and never log or share it. The QR rotates while WAHA is in `SCAN_QR_CODE`; refresh it when needed. A platform super-admin without an organization-scoped user cannot select a tenant through this interface.

The adapter creates a missing session with signed webhook configuration and starts it. Existing sessions are not reconfigured; after changing the webhook key or URL, provision/update the session through an approved WAHA administrative procedure before relying on webhooks. Concurrent creation or starting an already-started session may fail safely; retry after checking status. Provider errors are deliberately generic. Structured warnings contain only a fixed event and reason, never provider URLs, response bodies, exception text, session names or credentials. Status responses are capped at 64 KiB and QR responses at 1 MiB before parsing or encoding. WAHA's detailed documentation shows GET for QR while its feature summary says POST; GET remains unverified against a live version.

## Webhook boundary

Only the exact lowercase canonical path `POST /api/whatsapp/webhook` is supported and exempt from cookie CSRF. Case aliases and trailing-slash variants are rejected; configure WAHA and any reverse proxy to preserve the canonical path. It requires `X-Webhook-Hmac-Algorithm: sha512` and a lowercase hexadecimal `X-Webhook-Hmac` computed over the exact raw request body. Missing or invalid credentials are rejected. Accepted events are discarded with no processing; repeated deliveries have no side effects. This is not durable deduplication or exactly-once delivery. WAHA request IDs and timestamps are unsigned and are not replay protection. Do not enable message actions until durable authenticated event deduplication, identity authorization and tenant binding are implemented and independently reviewed.

Reference: [events](https://waha.devlike.pro/docs/how-to/events/), [sessions](https://waha.devlike.pro/docs/how-to/sessions/), [security](https://waha.devlike.pro/docs/how-to/security/), [storage](https://waha.devlike.pro/docs/how-to/storages/).
