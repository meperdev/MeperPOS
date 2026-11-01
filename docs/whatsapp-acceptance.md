# WhatsApp acceptance: what still needs the real number

This is the checklist that remains before the administrative channel can be called
accepted. Everything below requires resources or decisions that no amount of local
test work can supply: an installed WAHA version, the SIM, two real phones and the
owner's informed consent to running an unofficial connection.

**Nothing here has been done.** No number was scanned or linked, no WAHA container was
started, and no Docker or external account was touched. Where a claim depends on WAHA
documentation rather than an observed instance, say so, as this document does.

## Unverified against a real instance

| Area | What is assumed today | Why it needs the instance |
|---|---|---|
| Image tag | A WAHA version that supports two sessions in one instance | No image is pinned in configuration; the tag must be chosen, pinned and proved |
| QR pairing | `GET`/`POST` on the session endpoint, and the reported statuses | The documented shape and the passkey states vary by version |
| Event shape | `message.any` with `from`, `body`, `fromMe` and a signed `id` | The exact fields and the webhook signature over the raw body must be observed |
| `POST /api/sendFile` | `{ session, chatId, file: { mimetype, filename, data } }`, instance-level path | Field names and path are the most likely mismatch; a wrong shape surfaces as `503`, not a silent drop |
| `POST /api/sendText` | `{ session, chatId, text }`, instance-level path | Same as above: this is the path every administrative reply takes |
| Sender identifier | The central number's chat reports a phone JID (`@c.us` / `@s.whatsapp.net`) | If WAHA reports an opaque `@lid` for it instead, the administrative channel refuses every message by design until a LID-to-phone mapping is built and reviewed |
| Session persistence | Sessions survive a restart with the configured volume | Needs a real restart, not a mock |

## Preconditions before touching a number

1. **Consent, in writing, that WAHA is unofficially connected**: it can violate WhatsApp
   terms, disconnect or restrict the number, and change without notice.
2. **Two phones are present**: the central administrative number (what MeperPOS
   Intelligence answers) and the administrator's own phone (the sender the gate
   authorizes). Both SIMs active.
3. **The existing WhatsApp app on those numbers is not deleted or migrated.** Any
   procedure that asks to remove the current account is refused; coexistence or a
   spare number only.
4. **A test number is preferred** for the first pass. Do not start with the production
   commercial number.
5. **Backup of what exists**: current sessions, the identity rows, and a note of which
   phone is meant to be which.

## Acceptance steps

For each step, the evidence that counts is the observed instance output, not a
documented behaviour:

1. Pin the image tag and start the instance with its own compose file, private network
   and API key. Record the tag and the version the instance reports.
2. Create both sessions (commercial and central) and confirm both report a truthful
   status.
3. Pair the central number with a QR from the instance, then confirm the session stays
   connected after a restart.
4. Send one text from the administrator's phone and observe the webhook payload: the
   sender JID kind (phone or LID), the signed `id`, and a valid HMAC over the raw body.
   A wrong signature must be rejected; a replayed body must be dropped as duplicate.
5. Confirm the administrative reply arrives as one text message and that a second copy
   never arrives.
6. Link the administrator's phone through the identity challenge, then confirm
   `resumen`, `atencion` and `pdf` behave as documented, that an unknown command gets the
   deterministic sentence, and that a stranger's phone gets silence.
7. Confirm the PDF arrives and that a `pdf` command produces no extra text message.
8. Send an `@lid` message, if the instance produces one, and confirm it is refused
   without being recorded as processed.
9. Stop the instance mid-flight and confirm recovery does not replay a sent reply.

## Abort criteria

Stop and report instead of continuing if: the instance reports a LID for the central
number, the QR flow requires migrating or deleting the existing WhatsApp account, the
send endpoints reject their documented shape, a second copy of any message is observed,
or anything writes to a business table that the test did not expect.

## Decisions that block enabling the model

Recorded in `docs/whatsapp-intelligence-model.md`: provider and model, privacy and
processing location, per-organization budget and the behaviour when it is exhausted,
and whether a per-organization kill switch is required. None is inferred.

## Out of scope for this stage

The commercial assistant (a customer-facing assistant answering clients) stays out of
this stage by decision. This stage covers the administrative channel only.
