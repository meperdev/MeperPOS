# Model seam for the administrative assistant

This document describes the boundary between the administrative WhatsApp channel and
any future language model. It explains what exists today, what is deliberately
missing, and the decisions that must be taken before a provider is chosen.

**No provider and no model is selected, and nothing in this stage reaches one.** The
shipped binding (`UnconfiguredWhatsAppModelProvider`) never calls anything and always
refuses. The administrative channel therefore keeps behaving exactly as it did before
the seam existed: only the deterministic allowlist in `whatsapp-admin.service.ts`
produces an answer.

## Why a seam and not a provider

Choosing a provider by name decides three things at once — where the business'
phrasing is processed, what it costs per message, and which vendor can see it. Those
are business decisions, not implementation details, so the boundary is built first and
the provider is a separate, later decision.

## What may be sent

One request carries exactly three fields, and the type has no fourth:

| Field | Content |
|---|---|
| `text` | The normalised message body (same string the allowlist compared). Maximum 512 characters. |
| `tools` | The static tool catalogue: two names and two descriptions. Identical for every sender and every organization. |
| `timeoutMs` | The deadline the adapter must honour (5 s). |

Never sent: the sender's phone, the identity, the user, the organization, the
conversation, any figure, any report content, and any history. There is no field for
them, so a future caller cannot add one without changing the type.

Note what this does **not** solve: whatever the administrator types is part of the
body. If she types a customer's phone number or a name, that text is what a provider
would receive. That is a consequence of the feature, not a leak in the boundary, and
it is one of the reasons the provider and processing-location decision comes first.

A body over the size bound is refused before any call: it is not a command this stage
is willing to pay to interpret.

## What may come back

The closed catalogue is two read tools:

- `daily_summary` — the day's totals from `DailyReportService`, reduced to aggregates.
- `supervision_summary` — the aggregate conversation counts and one median.

The report-PDF tool is deliberately **absent**. A model can never make the channel send
a document: the PDF leaves the system only through the explicit, deterministic
command an administrator wrote. Likewise no tool takes a parameter, so a model cannot
choose a date, a limit, a customer, an organization or a filter.

Every answer is validated on this side by `parseModelIntent`, because a provider is
untrusted output, not an authority. The accepted shape is one object whose only own
property is `tool`, naming a catalogue entry:

- an unknown or differently cased name (`DAILY_SUMMARY`, `list_customers`,
  `daily_report_pdf`) is refused;
- any extra property (`organizationId`, `phone`, `customerId`, `since`, `text`) is
  refused — an ignored parameter is a capability someone eventually reads;
- anything that is not a plain object (prose, JSON-as-string, an array) is refused.

A refusal is not an error message to the administrator: the gate answers with the same
"no entiendo ese comando" sentence it answers today, and reads nothing.

## Limits

| Limit | Value | Where it is enforced |
|---|---|---|
| Request size | 512 characters | `buildModelRequest`, before any call |
| Deadline per interpretation | 5 s | enforced by the gate; the adapter must also honour the request deadline |
| Calls per inbound message | 1, no retries | single call site; the webhook receipt is already spent |
| Tools selectable | 2 read-only | closed catalogue + `parseModelIntent` |
| Parameters per tool | 0 | the intent type has no parameter field |
| Document delivery from a model | impossible | the PDF tool is not in the catalogue |

The gate stops waiting at the deadline, but cannot cancel an adapter's underlying
request. Adapters must enforce their own transport deadline to limit resource use.

Cost is therefore bounded by one interpretation per inbound message that the allowlist
did not already answer. The remaining cost question is the price of that call, which
belongs to the provider decision.

## Enabling it later

Exactly one change turns the seam on: replace the `WHATSAPP_MODEL_PROVIDER` binding in
`whatsapp.module.ts` with a real adapter. That adapter must:

1. honour `request.timeoutMs` and surface a timeout as `{ status: 'unavailable' }`;
2. parse the model's structured output and return `{ status: 'intent', intent }` with
   the raw object untransformed, so `parseModelIntent` validates it;
3. return `{ status: 'unsupported' }` when the model understood the text but no tool
   fits;
4. never log the request or the response (they contain the administrator's text);
5. be covered by the same boundary tests, plus its own transport tests.

## Open decisions

These are blocking acceptance items, not implementation details:

1. **Provider and model**, compared on quality for Spanish (Colombian) phrasing, price
   per interpretation, latency and stability.
2. **Privacy and processing location**: where the text is processed, whether it is
   retained by the provider, and whether a zero-retention option exists. The business'
   administrative phrasing may contain customer data typed by hand.
3. **Budget**: per-organization monthly cap and what happens when it is exhausted
   (refuse with the deterministic sentence, never fall back to paying silently).
4. **Kill switch**: whether a per-organization toggle is required before the first real
   number, given that disabling the model simply returns the channel to today's
   behaviour.

None of these can be settled by reading documentation alone, and none is inferred by
this stage.

## Test coverage

- `whatsapp-intelligence-model.spec.ts` — the boundary: catalogue contents, request
  shape and bounds, hostile bodies staying inert inside `text`, and every rejected
  intent shape.
- `whatsapp-admin-model.spec.ts` — the gate: unchanged behaviour while unconfigured,
  the request payload carrying no identity or organization, validation of the model's
  answer, a provider that throws not failing the webhook, the model never consulted
  for an allowlisted command or an oversized body, and silence for a stranger.
