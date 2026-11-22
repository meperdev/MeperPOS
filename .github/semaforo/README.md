# Semáforo automático

`.github/workflows/semaforo.yml` labels every pull request with
`semaforo:verde`, `semaforo:amarillo` or `semaforo:rojo`, and keeps one summary
comment (`<!-- semaforo-bot -->`) listing the color, the reasons and a
non-binding `trust:` suggestion. It only labels and comments: it never blocks a
merge and it is not a required check.

## Where the criteria live

`.github/semaforo/config.json` is the only source of rules. Its criteria are
the ones in `.github/pull_request_template.md` ("Semáforo (suggested)"): verde =
ready for a human to merge, amarillo = wants an AI review first, rojo = needs
human review and is required for new lint rules, architecture, auth, payments,
inventory and payroll.

Every changed path is matched against every rule — both sides of a rename and
deleted files included — and a file takes the highest color among the rules it
matches. A file no rule matches is "code" (amarillo). The PR takes the highest
file color. Verde is then capped by size (`size.maxVerdeChangedLines` = 400 and
`size.maxVerdeFiles` = 30, lockfiles excluded): a larger PR is amarillo, never
rojo, because it wants an AI review first, not because it is riskier.

A bug in the labeling becomes a rule in that config plus a test in
`classify.test.mjs`: fix the rule, not the PR.

## Overrides

- `semaforo:manual` on a PR: the bot leaves the labels alone.
- A person adds or removes any `semaforo:*` label: the bot stops touching the
  PR's semáforo labels for good. The one exception is that it removes its own
  label if a person's color is also set, so the PR never shows two colors.
- Ownership is read from the PR's issue events (who added or removed each
  label), so it survives edited comments and cancelled runs. If the events
  cannot be read, no label is changed.

## Failure modes: always "no change + warning"

API errors, a fork PR (read-only token: it computes the color and prints it to
the job summary), a label that does not exist in the repository (never created
by the bot), a truncated file list (`changed_files` larger than what the API
returned: never verde), an empty diff (no label) and a missing token all end in
a `::warning::` and exit 0. Every step has `continue-on-error`, so a
classification problem can never paint a red X on the PR.

## Files

- `config.json` — rules, thresholds, labels, trust suggestions.
- `classify.mjs` — pure classifier (paths in, `{ color, reasons }` out) and the
  glob matcher.
- `decide.mjs` — pure label decision (add/remove) and comment rendering.
- `run.mjs` — the workflow entry point; `SEMAFORO_DRY_RUN=1` prints the plan
  and writes nothing.
- `classify.test.mjs`, `decide.test.mjs`, `run.test.mjs` — `node:test`, no
  dependencies; they run in the existing `lint` job of `ci.yml`.
- `demo.mjs` — read-only calibration: `GITHUB_TOKEN=$(gh auth token) node
  .github/semaforo/demo.mjs 393` classifies real PRs and compares the labels.
