---
date: 2026-11-21
layer: "01/02"
title: Numeric Input digits clipped behind the stepper in compact cells
source: "UI polish round 4"
pr: 394
paths:
  - frontend/src/components/ui/Input.tsx
  - frontend/src/components/purchase-orders/PurchaseOrderItemEditor.tsx
tests:
  - frontend/src/components/ui/Input.test.tsx
  - frontend/src/components/purchase-orders/purchase-order-modals.test.tsx
---

Numeric `Input` fields inside compact purchase-order table cells (`w-24` + `TableCell`'s `2xl:px-5`) had only 4px of inner width at `2xl` and let `px-*` overrides wipe out `pr-9`, clipping digits behind the `w-7` stepper. `Input` now enforces `pr-9` after `className` (and supports `hideStepper`), while `PurchaseOrderItemEditor` widens numeric columns (`w-28 min-w-28`) and overrides `2xl:px-2`.
