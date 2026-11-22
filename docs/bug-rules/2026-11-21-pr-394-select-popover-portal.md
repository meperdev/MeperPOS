---
date: 2026-11-21
layer: "01/02"
title: Desktop Select menu clipped inside overflow containers
source: "UI polish round 4"
pr: 394
paths:
  - frontend/src/components/ui/Select.tsx
tests:
  - frontend/src/components/ui/Select.test.tsx
  - frontend/src/components/ui/Modal.test.tsx
  - frontend/src/components/expenses/expense-form-modal.test.tsx
---

Desktop `Select` rendered an inline `position: absolute` menu inside nested `overflow-hidden` / `overflow-y-auto` containers (such as `ExpenseFormModal` payments), clipping options when opened upwards/downwards. Desktop popovers now portal to `document.body` (`[data-select-popover]`, `position: fixed`) and `Modal` focus-trap whitelists it alongside `[data-select-sheet]`.
