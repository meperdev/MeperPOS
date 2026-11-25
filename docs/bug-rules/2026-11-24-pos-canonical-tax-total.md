---
date: 2026-11-24
layer: "01+02"
title: POS checkout rounds IVA per line and settles payments in cents
paths:
  - frontend/src/app/pos/page.tsx
  - frontend/src/components/pos/PaymentConfirmationModal.tsx
  - frontend/src/components/ui/CurrencyInput.tsx
  - backend/src/sales/sales.service.ts
tests:
  - frontend/src/app/pos/page.behavior.test.tsx
  - frontend/src/components/pos/PaymentConfirmationModal.test.tsx
  - frontend/src/components/ui/CurrencyInput.test.tsx
  - backend/src/sales/sales.service.payments.float.spec.ts
---

A COP 1,005 item with 19% IVA and a 15% line discount has a taxable base of 854.25. The POS used to prefill 1,016.5575, but the sales API stores 162.31 of line tax and charges 1,016.56. The raw underpayment comparison rejected the card payment, and the integer input turned the fractional digits into whole pesos (`10.165.575`).

The POS mirrors the API’s line-tax rounding before summing and uses integer cents for prefills, remaining balances, and payment checks. The API compares the cents it will store for each tender with the payable cents, without changing the fiscal reconciliation rules. The checkout field uses decimal mode to display and edit `1.016,56`; ordinary integer fields round before formatting instead of appending fractional digits.
