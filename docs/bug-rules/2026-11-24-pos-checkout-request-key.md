---
date: 2026-11-24
layer: "01+02"
title: POS cash/card checkout created a second sale when the response was lost
source: "POS checkout idempotency gap (SEC-014 follow-up; the financing path already pinned one key per attempt)"
pr:
paths:
  - frontend/src/app/pos/page.tsx
  - frontend/src/hooks/useSales.ts
tests:
  - frontend/src/app/pos/page.behavior.test.tsx
  - frontend/src/hooks/useSales.test.ts
---

The backend has deduplicated `POST /api/sales` on `requestKey` since SEC-014 (hash
plus unique index, replay returned before pricing, numbering or stock are
touched), and the financed-sale path already minted one key per attempt. The
ordinary cash/card checkout never sent one: `useCreateSale` did not declare the
field and `handleCheckout` did not set it, so a response lost after the sale was
persisted left the cashier looking at an unchanged cart. Retrying created a
second sale, two payments and a second stock decrement for the same intent — the
server had the mechanism, the client never used it.

The type alone could not catch this: the field is optional on `CreateSaleDto`, so
`useCreateSale` accepted a body without it and TypeScript stayed quiet. The fix
raises it to **01** anyway — `requestKey?: string` is now part of the
`useCreateSale` input type, so the intent key is a declared part of the payload
rather than an untyped extra — and closes the behavior at **02** with tests on
the two observable rules:

- `handleCheckout` pins one key per request body: it builds the exact body
  without the key, serializes it as its identity, reuses the pinned key while a
  retry carries that same body, and mints a new one when the cart, customer,
  discount **or payment split** changes. A success clears the pin, so a second,
  deliberate identical sale gets a new key instead of replaying the first.
- `useCreateSale` forwards a pinned `requestKey` unchanged on the POST, while a
  body without one still posts exactly as before (the compatibility case the
  existing hook test pins).

`page.behavior.test.tsx` covers the three cases end to end through the rendered
POS: a key is sent with the unchanged sale body, a retry of the same checkout
reuses it, a payment-only edit after a failure mints a new one, and an identical
sale after a success mints another. `useSales.test.ts` covers the forwarding and
the keyless body. The pattern mirrors the financed-sale precedent
(`posLoanAttemptRef`), kept as a separate checkout-only ref so neither path can
consume the other's key.
