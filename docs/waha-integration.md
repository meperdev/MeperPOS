# WAHA integration: two WhatsApp sessions in one instance

This integration uses unofficial WhatsApp automation. It can violate WhatsApp terms, disconnect or restrict a number, and change without notice. Do not scan a production number until its owner accepts these risks and chooses a test number. This stage covers connection registry, session lifecycle, signed webhook routing, durable event deduplication, the administrative identity gate and its deterministic text replies, and on-demand or scheduled report delivery.

## Two channels, one WAHA instance

One WAHA container runs **two independent sessions**. They are separate WhatsApp logins; they are not two servers and they never share credentials.

| Channel | Session name | Number | Who it talks to | Owner |
|---|---|---|---|---|
| `COMMERCIAL` | `meper-commercial-<sha256(organizationId)>` | Número A — the shop's commercial number, shared by both sedes | Customers, and the employees who answer them by hand | One organization |
| `INTELLIGENCE` | `meper-intelligence` | Número C — the number reserved for MeperPOS Intelligence | The administrator's personal phone (Número B, which is **not** connected to WAHA) | The platform, centrally |

Número A and Número C are different numbers and must never be paired into the same session. If a message appears to come from the wrong channel, the sessions were paired with the wrong phone: stop and re-link, do not patch it downstream.

The commercial channel belongs to exactly one organization and is managed by that organization's `ADMIN` (`OWNER` inherits). The intelligence channel is a single central channel modelled with a null `organizationId` from the start, so it can later serve several organizations with logical isolation; it is managed only by a platform `SUPER_ADMIN` and is reachable through no organization scope at all. Cross-tenant access is therefore impossible by construction, not by filtering.

## Administrative surface

Sessions are driven through the backend, never through WAHA's dashboard (which stays disabled and unpublished).

| Route | Method | Required |
|---|---|---|
| `/api/whatsapp/commercial/session` | `POST` | JWT + `RolesGuard` `ADMIN` (`OWNER` inherits) + `OrganizationRequiredGuard`; creates the caller's session if missing, starts it, returns `{ status }` |
| `/api/whatsapp/commercial/session` | `GET` | same guards; returns the observed `{ status }` |
| `/api/whatsapp/commercial/session/qr` | `GET` | same guards; returns `{ data }`, a base64 PNG |
| `/api/whatsapp/commercial/session/stop` | `POST` | same guards; `204` |
| `/api/whatsapp/commercial/session/restart` | `POST` | same guards; `204` |
| `/api/whatsapp/intelligence/session` | `POST` | JWT + `RolesGuard` `SUPER_ADMIN` only, **no** `OrganizationRequiredGuard`; creates/starts the central session, returns `{ status }` |
| `/api/whatsapp/intelligence/session` | `GET` | same; returns `{ status }` |
| `/api/whatsapp/intelligence/session/qr` | `GET` | same; returns `{ data }`, a base64 PNG |
| `/api/whatsapp/intelligence/session/stop` | `POST` | same; `204` |
| `/api/whatsapp/intelligence/session/restart` | `POST` | same; `204` |
| `/api/whatsapp/intelligence/session/logout` | `POST` | same; `204`. Unlinks the number and keeps the session record |
| `/api/whatsapp/webhook` | `POST` | WAHA HMAC only (see below) |

A session name is **never** accepted from a request. The caller names a channel; the backend derives the session name from the authenticated organization or from the fixed central constant. Authorization comes from the persisted connection row and the token, never from the session string a webhook happens to carry.

`logout` exists only for the central channel. Unlinking the commercial number from a distant machine would leave customers unanswered until someone reaches the phone, so that decision stays a manual, physical one.

A missing organization on a commercial call is `403`, not a default tenant. The organization always comes from the access token; an `X-Organization-Id` header or body field is ignored.

## Configuration and isolation

Set these in the backend's secret manager, not in source control or logs:

- `WAHA_BASE_URL`: private HTTP(S) origin of the WAHA service, reachable only by trusted backend workloads.
- `WAHA_API_KEY`: private WAHA API key, identical to WAHA's configured key.
- `WAHA_WEBHOOK_HMAC_KEY`: the deployment **master** secret. It is no longer the value handed to WAHA — see the next section.
- `WAHA_WEBHOOK_URL`: full URL WAHA can reach for `POST /api/whatsapp/webhook`.

All four are required. With any missing value every session operation fails closed (`403`) instead of starting a session whose events could not be verified. Restrict network access between WAHA and the backend; if traffic crosses an untrusted network use authenticated transport/TLS. Never publish WAHA's port or expose its dashboard, Swagger, API key, HMAC key, session files or QR to the public. WAHA's API key protects its API; the webhook HMAC is a separate secret. Protect and back up the session volume as credentials.

`backend/docker-compose.yml` remains the PostgreSQL-only configuration and does not require WAHA variables. The separate `backend/docker-compose.waha.yml` defines WAHA with a named `/app/.sessions` volume, no published port and disabled dashboard and Swagger. Supply `WAHA_IMAGE` as a verified immutable image reference and `WAHA_API_KEY` through the deployment secret mechanism; do not put them in command arguments. From `backend/`, an explicitly approved deployment can start it with `docker compose -p meper-waha -f docker-compose.waha.yml up -d`. Do not combine this file with the PostgreSQL Compose file for the ordinary database workflow: Compose interpolates variables before profile selection. No image tag has been verified here; do not treat a release number or `latest` as a verified pin.

WAHA joins the separate `meper-waha_waha_private` bridge under the specified project name, not the database's default network. The deployment must explicitly attach the backend to that bridge and separately to its database network, provide a backend address reachable from WAHA for the webhook, and limit network membership to trusted workloads. A host-only backend is not automatically reachable from the container; establish an explicitly secured route rather than publishing WAHA. The bridge allows outbound traffic and is not encryption or a firewall; configure deployment firewall and TLS as appropriate. The project name also scopes the persistent volume: changing it or moving an existing WAHA deployment requires a planned volume migration, not an automatic copy. An isolated pilot connected WAHA and the backend on a private Docker network; that observation does not verify this deployment topology, transport security or image suitability.

## Session names and webhook keys

Session names are derived, stable and not secrets:

- `COMMERCIAL`: `meper-commercial-` + the first 32 hex characters of `sha256(organizationId)`.
- `INTELLIGENCE`: the constant `meper-intelligence`.

The raw organization id never appears in a name, and a caller cannot supply one.

WAHA signs each webhook with the HMAC key configured on that session. Instead of sharing one key with both sessions, `WAHA_WEBHOOK_HMAC_KEY` is a **master**: the backend derives a distinct per-session key with `HMAC-SHA256(master, "waha:webhook:" + sessionName)` and hands only that 64-hex-character derived value to WAHA when it creates the session. Consequences to keep in mind:

- A key leaked from one session's WAHA configuration cannot sign events for the other session, and cannot be reversed into the master.
- Rotating the master invalidates every derived key at once. Existing sessions are not reconfigured automatically; after rotating the master or changing `WAHA_WEBHOOK_URL`, update each session through an approved WAHA administrative procedure before relying on its webhooks again.
- The backend reads the session name from the payload only to *select* the key. It is not trusted until the HMAC over the exact raw bytes passes: a body claiming another session derives another key and is rejected with `401`.
- A missing master secret cannot derive any key, so the whole surface fails closed rather than running unverifiable sessions.

## Events, and what a "state" is not

Each session is created with a single subscription: `message.any`. The narrower `message` event reports only inbound messages, so replies an employee sends by hand from the phone would be invisible and the commercial channel could not be supervised. `message.any` also lets the channel distinguish automatic from human intervention.

Webhook requests must arrive on the exact lowercase path `POST /api/whatsapp/webhook`; that path alone is exempt from cookie CSRF. Case aliases and trailing-slash variants are rejected, so configure WAHA and any reverse proxy to preserve the canonical path. Requests require `X-Webhook-Hmac-Algorithm: sha512` and a lowercase hexadecimal `X-Webhook-Hmac` over the exact raw request body; missing or invalid credentials are `401`.

Deduplication is durable and keyed by the provider event id taken from the **signed payload** (`payload.id`), stored per connection in `WhatsAppProcessedEvent` under a unique `(connectionId, providerEventId)` constraint. Transport metadata — WAHA's request id, delivery timestamp, retry counter — is unsigned and is never used as a deduplication key or as replay protection. A validly signed replay whose receipt is already recorded is dropped; an invalid signature is rejected. A central LID lookup can fail before a receipt exists, so a later valid redelivery may still be processed. Events with no signed message id are dropped without effect, because they cannot be deduplicated.

Nothing here stores message content on the commercial channel beyond what the supervision read model already records. The central channel does act on an inbound message: it links an identity, runs the administrative gate and may send one text reply. Those behaviours are bounded in the next section.

## Administrative text replies

The central channel answers one inbound text message from the administrator with one deterministic text message. Nothing is generated by a model in this stage: the command allowlist, the read tools and the wording are fixed in code, and the reply is rendered from aggregates the server already computed.

| What the administrator sends | What happens | Reply |
|---|---|---|
| `resumen`, `cierre del dia`, `reporte de hoy`, … | `DailyReportService` for the identity's own organization, reduced to totals and counts | Date, sales total and count, expenses, low stock, pending purchase orders, loans due |
| `atencion`, `conversaciones`, `como va la atencion`, … | `WhatsAppSupervisionService` aggregate read model | Conversation, state, contact-kind and pending counts plus the median first response |
| `pdf`, `manda el reporte`, … | `WhatsAppDeliveryService.onDemand` sends the report PDF | **No text.** The document is the only side effect |
| Anything else | No read tool runs | `No entiendo ese comando…` when the sender is authorized |
| A read tool fails | — | `No pude obtener la información…` when the sender is authorized |

The gate runs before the allowlist and the reply:

1. Only literal `fromMe: false` permits an inbound text to link or reach authorization. A phone JID (`@c.us`, `@s.whatsapp.net`, or a bare number) is parsed as a phone; an opaque `@lid` must first resolve through WAHA as described below.
2. Only then are the phone digits matched against the identity table. A linking challenge must match an unconsumed challenge issued to an authenticated user.
3. The identity must be `VERIFIED` and carry an organization.
4. The role is read from `OrganizationUser` for that user in that organization; only `OWNER` and `ADMIN` are authorized. The user and organization must have `active: true`; all organization statuses retain read access, but `SUSPENDED` blocks PDF delivery.

An `unlinked`, `PENDING`, `REVOKED`, organization-less, `MEMBER`, `CASHIER` or `INVENTORY_USER` sender gets **silence**, not a refusal message: any reply would confirm that this number is in service and could be used to enumerate registered phones. The same silence applies to group chats, messages without literal `fromMe: false`, and every duplicate provider event. The reply goes only to the sender's own verified number, derived from that identity; no phone, chat id or organization from the message body is ever used as a destination.

### Opaque senders are not telephone numbers

For an inbound central-channel LID, the adapter makes an API-key-authenticated direct WAHA lookup for that session. It requires an exact returned LID match and a `pn` phone JID with 8–15 digits, starting nonzero. The event boundary also validates the resolved digits before using them as a phone. LID digits are never compared with stored phones. A valid association only supplies a phone: the existing challenge, identity, role and organization checks still apply, and webhook HMAC verification remains required.

Missing, failed, malformed or inconsistent associations fail closed before the receipt: no link, administrative read or reply occurs. A transient lookup failure is silently dropped rather than retried by this service; after recovery the sender must resend. A later provider redelivery can be processed if the mapping then succeeds, because no receipt was recorded. Once the receipt is committed, the at-most-once boundary below applies.

An isolated real-phone linking challenge was consumed and created a verified identity for a fictitious administrator. WAHA's message-by-ID reported the sender as a LID, and the individual lookup for that exact LID returned the verified phone. The provider list did not show the association; the reason is unknown, and the adapter uses the individual endpoint. The original WAHA container logged a sampled LID in the lookup path and is stopped but preserved. The approved alternate disables Docker logging, reducing observability; a synthetic test found no sample identifier in new backend logs, but absence of all other traces is not proven. The private Docker network is not TLS. Do not generalize this mitigation to production; verify provider/proxy logging and transport for each deployment. Full real acceptance remains pending; see `docs/whatsapp-acceptance.md`.

The commercial channel is unaffected: it stores a LID as its own opaque conversation key, never classifies it as a customer or an internal contact, and never matches it against a phone. `normaliseContactPhone` keeps serving the callers that need a digits-only reduction (delivery targets and the gate's own input); the mapping and refusal above belong to the intelligence boundary in `WhatsAppEventsService`, not to that shared helper.

### Delivery bound

The deduplication receipt is committed before the gate runs. A reply is attempted once, after that commit, and is never retried by this service or by a provider redelivery:

- If the process crashes between the receipt and the send, the reply is lost. The provider's redelivery is a duplicate and is dropped.
- If the provider accepts the request but its response cannot be read, the text is treated as sent with an unknown provider message id, not as a failure. It may or may not have reached the phone.
- If the provider rejects the request or the transport throws, the failure is logged as a fixed outcome and the event still counts as handled. The administrator receives nothing.

This is **at most once**, never exactly once. Delivery is not confirmed: a resolved send means the request was accepted by WAHA, not that the message was read.

Text uses WAHA's documented `POST /api/sendText` with `{ session, chatId, text }`, the session in the body and the instance-level path, mirroring `POST /api/sendFile`. Those field names and the path must be confirmed against the installed WAHA version. A provider rejection raises `503 WhatsApp provider unavailable` inside the adapter, but the webhook reply path catches a send failure after committing the receipt: the webhook can still succeed and the reply is not retried. The commercial channel is untouched: it never sends text replies.

Application logs for these paths use fixed outcome markers (`reply_sent`, `reply_failed`, `gate_error`, `unverified_sender`, …), not phones, chat ids, message bodies, provider text or figures. This does not cover WAHA or proxy/access logs: the original pilot WAHA logged a sampled LID in the lookup path. The alternate pilot container disables Docker logging; verify privacy independently for any other deployment.

## QR linking

The QR is requested from the backend, never from the WAHA dashboard:

```http
GET /api/whatsapp/commercial/session/qr
GET /api/whatsapp/intelligence/session/qr
Cache-Control: private, no-store
→ 200 {"data": "<base64 PNG>"}
```

The adapter calls WAHA's `GET /api/{session}/auth/qr` with `Accept: application/json` and reads `{ mimetype, data }`, stripping any `data:` prefix. QA finding L5: WAHA's sessions page lists `POST /api/{session}/auth/qr` in its feature table while its detailed section documents `GET` returning `{ mimetype, data }`. This implementation uses the documented `GET` + JSON form and treats a mismatch (for example `405`) as a provider failure surfaced as `503 WhatsApp provider unavailable`. **Confirm the verb against the installed WAHA version** before rolling out; if the installed version only answers `POST`, the adapter must be changed, not worked around in the client.

QR responses are `private, no-store` and are capped at 2 MiB before parsing (1 MiB of base64) to bound memory. Treat a QR as a login credential: never log it, never paste it in a ticket, never send it over chat. It rotates while the session is in `SCAN_QR_CODE`; simply request it again.

### Linking Número A (commercial)

1. Have the phone that holds Número A in hand, unlocked, with the WhatsApp application already installed and signed in.
2. As an `ADMIN`/`OWNER` of the organization, call `POST /api/whatsapp/commercial/session`. This creates the session with its derived webhook key and starts it.
3. Call `GET /api/whatsapp/commercial/session` until the status is `SCAN_QR_CODE`. Other states are normal at this point; see the status table.
4. Call `GET /api/whatsapp/commercial/session/qr` and display the returned image to whoever holds the phone.
5. On the phone: WhatsApp → Settings → Linked devices → Link a device, then scan.
6. Poll `GET /api/whatsapp/commercial/session` until it reports `WORKING`. The backend mirrors the status and the linked account id onto the connection row.
7. Send a test message to Número A from an unrelated phone and confirm it is recorded against the commercial channel.

### Linking Número C (intelligence)

The same six steps with the central routes, performed by a platform `SUPER_ADMIN`, on the phone that holds Número C:

1. `POST /api/whatsapp/intelligence/session` — creates/starts `meper-intelligence`.
2. `GET /api/whatsapp/intelligence/session` until `SCAN_QR_CODE`.
3. `GET /api/whatsapp/intelligence/session/qr` and show the image.
4. On the Número C phone: Linked devices → Link a device → scan.
5. Poll until `WORKING`.
6. Send a test message from Número B (the administrator's personal phone, never paired) and confirm it arrives on the intelligence channel.

Both sessions can be linked one after the other without stopping the other. Linking one never affects the other's credentials or webhook key.

## Statuses

The backend mirrors WAHA's status onto the connection row after every lifecycle command, so the registry never drifts from the session it describes:

| Status | Meaning | What to do |
|---|---|---|
| `STOPPED` | Session created but not running | `POST .../restart` |
| `STARTING` | Boot in progress | Wait; poll again |
| `SCAN_QR_CODE` | Waiting for a phone to scan | Show the QR to the phone that holds the number |
| `PASSKEY_REQUIRED` | WhatsApp asks for the account passkey before continuing | An operator must enter the passkey on the phone; retrying the API does nothing |
| `PASSKEY_CONFIRMATION_REQUIRED` | The passkey was entered and needs confirmation on the phone | Confirm on the phone |
| `WORKING` | Linked and exchanging messages | Nothing |
| `FAILED` | WAHA could not establish the session | Read WAHA's own logs, then `restart`; do not re-pair blindly |

The passkey states are operator decisions, not outages: they need the phone, not a retry loop. An unrecognised status is treated as a provider failure, never as success, because guessing a status would corrupt the registry the webhook resolves from.

Two further conditions look like failures but are WhatsApp rate limits. Both are **states to wait out**, not outages:

- **Reachout timelock (`463`)**: WhatsApp refuses to start a new conversation with a number it considers too new or too unfamiliar. Outbound messages to that contact simply will not go out for a while.
- **Message capping (`475`)**: the number has hit WhatsApp's messaging limit for a new or low-trust account. Outbound volume is capped until the limit relaxes.

Neither means the session is broken, and neither is fixed by restarting or re-linking — restarting can even worsen the account's standing. Keep the session `WORKING`, keep answering customers manually, and let the limit expire. Inbound traffic is unaffected.

Provider failures are deliberately generic (`503`). Structured warnings contain only a fixed event name and reason — never provider URLs, response bodies, exception text, session names, QR content or credentials.

## When WAHA stops working

WAHA depends on unofficial connections and can break after a WhatsApp update, a container restart, a phone reboot or a network change. The commercial channel is a live customer channel, so the priority order is: keep answering, then repair.

1. **Answer customers from the phone.** While the session is down, the WhatsApp application on the Número A phone still works normally. Employees answer there exactly as they did before this integration existed; every conversation stays with the business. Do not wait for the API to recover.
2. **Do not delete the session.** `POST .../stop` and a container restart are reversible; removing the session destroys its stored credentials and forces a fresh pairing.
3. **Check the status before anything else.** `GET /api/whatsapp/commercial/session` distinguishes "WAHA is down" (`503` provider unavailable) from "the session is stopped/starting/failed". Restart the session, not the registry.
4. **Check whether WhatsApp still has the device linked** (phone → Settings → Linked devices). **Never re-pair a number before checking this.** Re-pairing a device that WhatsApp still shows as linked can revoke or duplicate credentials, produce two competing sessions, and leave one of them silently receiving nothing. If the device is still listed, the problem is on the WAHA side: recover or restart the container and the session. If the entry is gone, then and only then re-link with a fresh QR.
5. **Re-link with the normal QR flow** once the session is genuinely unlinked, and confirm `WORKING` plus one delivered test message per channel before telling staff the integration is back.
6. **Record what happened.** If WAHA changed behaviour (verb, payload shape, status string), the adapter — not the deployment — needs the correction.

Intelligence is not a live customer channel: if it stays down, customers are unaffected and only the administrator's own queries pause.

Reference: [events](https://waha.devlike.pro/docs/how-to/events/), [sessions](https://waha.devlike.pro/docs/how-to/sessions/), [security](https://waha.devlike.pro/docs/how-to/security/), [storage](https://waha.devlike.pro/docs/how-to/storages/).
