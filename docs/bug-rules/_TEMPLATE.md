---
# Copy this file to docs/bug-rules/YYYY-MM-DD-<slug>.md (lowercase letters,
# digits, hyphens): 2026-11-21-pr-392-csrf-cookie-ttl.md once the PR number is
# known, or a descriptive slug like 2026-11-21-csrf-cookie-ttl.md before that.
# Files starting with "_" (like this one) are not entries.
# Required: date, layer. Everything else is optional; delete what you don't use.
date: YYYY-MM-DD
layer: "02" # 01 types/boundaries, 02 lint/test, 03 prose, or a mix like "01+02"
title: One-line summary of the bug or footgun
source: "Issue, explorer finding or audit item (markdown links are fine)"
pr: # PR number once known; empty is fine
paths:
  - path/to/the/rule/type/dto/or/guard
tests:
  - path/to/the/regression/test
---

The full bug or footgun: what broke or could break, why the old code allowed
it, and what now makes it unrepresentable or makes a machine catch it.
