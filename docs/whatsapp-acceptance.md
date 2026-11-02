# WhatsApp acceptance: what still needs the real number

This is the checklist that remains before the administrative channel can be called
accepted. Everything below requires resources or decisions that no amount of local
test work can supply: an installed WAHA version, the SIM, two real phones and the
owner's informed consent to running an unofficial connection.

**The real pilot is not accepted.** An isolated pilot reached `WORKING` on the
central session and initially refused a linking webhook from an unverified LID.
After the mapping change and privacy mitigation, a fresh challenge was consumed and
an identity was verified for a fictitious administrator in the isolated organization.
WAHA's message-by-ID reported a LID sender; its individual lookup returned that exact
LID and the verified phone. The automated signed-webhook tests use mocked WAHA and
Prisma. Administrative replies, PDF delivery and the other steps below remain unproved.

**The privacy mitigation is pilot-specific.** The original WAHA container logged a
sampled LID in the lookup path; it is stopped but preserved. The authorized alternate
uses Docker's `none` logging driver and has no published ports. A signed synthetic
webhook did not place its sample LID in new backend logs; a session-volume `.log`
containing sample bytes was classified as Chromium IndexedDB storage and retained.
The private Docker network is not TLS, provider observability is reduced, and absence
of all other traces is not proven. Production transport and logging require their own
security verification; the real-phone link does not constitute full acceptance.

## Unverified against a real instance

| Area | What is assumed today | Why it needs the instance |
|---|---|---|
| Image tag | A WAHA version that supports two sessions in one instance | No image is pinned in configuration; the tag must be chosen, pinned and proved |
| QR pairing | `GET`/`POST` on the session endpoint, and the reported statuses | The documented shape and the passkey states vary by version |
| Event shape | `message.any` with `from`, `body`, `fromMe` and a signed `id` | A pilot webhook reached the backend; complete field and HMAC acceptance still needs evidence |
| `POST /api/sendFile` | `{ session, chatId, file: { mimetype, filename, data } }`, instance-level path | The installed endpoint shape and delivery behavior need confirmation; provider errors may be caught by the caller |
| `POST /api/sendText` | `{ session, chatId, text }`, instance-level path | The installed endpoint shape needs confirmation; webhook reply errors are caught after the receipt and are not retried |
| Sender identifier | A sender can arrive as a phone JID or opaque `@lid` | An isolated real challenge linked an identity and an individual lookup matched that sender's LID to its verified phone; provider list did not show the association and its reason is unverified |
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

The single isolated linking check above is complete; all other steps remain pending.
Before any further deployment, verify its privacy and transport separately. For each
step, the evidence that counts is observed instance behavior, not a documented
assumption. Do not record sensitive values:

1. Pin the image tag and start the instance with its own compose file, private network
   and API key. Record the tag and the version the instance reports.
2. Create both sessions (commercial and central) and confirm both report a truthful
   status.
3. Pair the central number with a QR from the instance, then confirm the session stays
   connected after a restart.
4. Send one text from the administrator's phone and observe the webhook payload: the
   sender JID kind (phone or LID), the signed `id`, and a valid HMAC over the raw body.
   A wrong signature must be rejected; a replayed body must be dropped as duplicate.
5. Link the administrator's phone through a fresh identity challenge.
6. Confirm an administrative reply arrives as one text message and that a second copy
   never arrives. Check `resumen`, `atencion` and `pdf`, the deterministic unknown-command
   reply, and silence for a stranger's phone.
7. Confirm the PDF arrives and that a `pdf` command produces no extra text message.
8. The isolated pilot linked one real `@lid` sender through a fresh challenge and
   confirmed its exact individual association without recording identifiers or codes.
   On each deployment, verify privacy and transport before repeating; confirm missing,
   inconsistent or invalid mappings are silently dropped before a receipt, and never
   substitute LID digits for a phone.
9. Test a transient lookup failure: the message is silently dropped before the
   receipt; after recovery the sender must resend. Stop the instance mid-flight and
   confirm recovery does not replay a sent reply after its receipt was committed.

## Abort criteria

Stop and report instead of continuing if: lookup privacy or transport is unverified,
a mapping is missing or inconsistent, the QR flow requires migrating or deleting the
existing WhatsApp account, the send endpoints reject their documented shape, a second
copy of any message is observed, or anything writes to a business table that the test
did not expect. Do not expose identifiers, messages, codes or credentials as evidence.

## Decisions that block enabling the model

Recorded in `docs/whatsapp-intelligence-model.md`: provider and model, privacy and
processing location, per-organization budget and the behaviour when it is exhausted,
and whether a per-organization kill switch is required. None is inferred.

## Out of scope for this stage

The commercial assistant (a customer-facing assistant answering clients) stays out of
this stage by decision. This stage covers the administrative channel only.
