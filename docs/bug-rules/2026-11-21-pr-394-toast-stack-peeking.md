---
date: 2026-11-21
layer: "02"
title: Collapsed toast cards vanished behind the front card
source: "UI polish round 4"
pr: 394
paths:
  - frontend/src/components/ui/Toast.tsx
  - frontend/src/components/ui/ToastStack.tsx
  - frontend/src/contexts/ToastContext.tsx
tests:
  - frontend/src/components/ui/Toast.test.tsx
  - frontend/src/components/ui/ToastStack.test.tsx
  - frontend/src/contexts/ToastContext.test.tsx
---

Collapsed `ToastCard` peeking used `top-0 origin-top` with `8px`/`scale(0.95)`, shrinking shorter or equal-height cards upward until they vanished behind taller/two-line front cards, while `ToastStack` lacked a peeking hit-zone, leaked `pinned` expansion across empty queues, and `ToastContext` started unpaused timers for toasts arriving during hover. Peeking cards now use `inset-0 origin-bottom overflow-hidden` (`12px` step) with a collapsed hit-zone, empty-queue state unmount reset, pause-aware `schedule()`, and front-promotion for refreshed duplicates.
