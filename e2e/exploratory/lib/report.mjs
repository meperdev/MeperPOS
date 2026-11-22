/**
 * Renders the explorer's REPORT.md and the GitHub issue drafts inside it.
 * Pure functions over plain data (plus writeRunFiles, which writes them), so
 * they are unit-tested without a browser.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYERS, SEVERITIES } from "./findings.mjs";

function minutes(ms) {
  return `${(ms / 60_000).toFixed(1)} min`;
}

function escapeCell(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Evidence paths are written relative to the report directory. */
function evidenceLines(evidence = {}) {
  const lines = [];
  if (evidence.screenshot) lines.push(`- Screenshot: [${evidence.screenshot}](${evidence.screenshot})`);
  if (evidence.trace) {
    lines.push(
      `- Trace: [${evidence.trace}](${evidence.trace}) (\`npx playwright show-trace ${evidence.trace}\`)`,
    );
  }
  if (evidence.network?.length) {
    lines.push("- Network:");
    for (const entry of evidence.network.slice(0, 5)) {
      lines.push(`  - \`${entry.method} ${entry.url}\` -> ${entry.status}${entry.body ? ` \`${escapeInline(entry.body)}\`` : ""}`);
    }
  }
  if (evidence.console?.length) {
    lines.push("- Console:");
    for (const message of evidence.console.slice(0, 5)) lines.push(`  - \`${escapeInline(message)}\``);
  }
  if (evidence.axe) {
    const nodes = evidence.axe.nodes?.slice(0, 3).map((n) => `\`${escapeInline(n)}\``).join(", ");
    lines.push(
      `- axe: \`${evidence.axe.id}\` (${evidence.axe.impact}), ${evidence.axe.count} node(s)${nodes ? `: ${nodes}` : ""}${evidence.axe.helpUrl ? ` — ${evidence.axe.helpUrl}` : ""}`,
    );
  }
  if (evidence.details) lines.push(`- Details: ${evidence.details}`);
  return lines;
}

function escapeInline(text) {
  return String(text).replace(/`/g, "'").replace(/\s+/g, " ").slice(0, 400);
}

function findingSection(finding) {
  const lines = [
    `### ${finding.id} — ${finding.title}`,
    "",
    `- Severity: **${finding.severity}**`,
    `- Category: ${finding.category}${finding.source !== "scripted" ? ` (source: ${finding.source})` : ""}`,
    `- Page(s): ${finding.urls.map((u) => `\`${u}\``).join(", ")}${finding.occurrences > 1 ? ` (seen ${finding.occurrences} times)` : ""}`,
    `- Suggested layer: **${LAYERS[finding.layer] ?? finding.layer}** — ${finding.layerReason}`,
  ];
  if (finding.expected) lines.push(`- Expected: ${finding.expected}`);
  if (finding.actual) lines.push(`- Actual: ${finding.actual}`);
  lines.push("", "Repro steps:", "");
  const steps = finding.steps?.length ? finding.steps : ["(no steps recorded)"];
  steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  const evidence = evidenceLines(finding.evidence);
  if (evidence.length) lines.push("", "Evidence:", "", ...evidence);
  lines.push("");
  return lines.join("\n");
}

/** Title and body of a GitHub issue for one finding (used in the report and by --file-issues). */
export function issueDraft(finding, context = {}) {
  const title = `[bug-bash] ${finding.title}`.slice(0, 240);
  const steps = finding.steps?.length ? finding.steps : ["(no steps recorded)"];
  const body = [
    "Found by the exploratory bug-bash runner (`e2e/`, `npm run explore`) against the isolated smoke stack.",
    "",
    `**Severity:** ${finding.severity}`,
    `**Page(s):** ${finding.urls.map((u) => `\`${u}\``).join(", ")}`,
    `**Suggested trust-stack layer:** ${LAYERS[finding.layer] ?? finding.layer} — ${finding.layerReason}`,
    "",
    "### Steps to reproduce",
    "",
    "Start the isolated stack (`cd e2e && SMOKE_KEEP_DB=1 npm run explore`, or `npm run smoke`) and sign in as the e2e seed owner, then:",
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    ...(finding.expected ? [`**Expected:** ${finding.expected}`, ""] : []),
    ...(finding.actual ? [`**Actual:** ${finding.actual}`, ""] : []),
    "### Evidence",
    "",
    ...(evidenceLines(finding.evidence).length ? evidenceLines(finding.evidence) : ["(see the report)"]),
    "",
    `Report: \`${context.reportPath ?? "e2e/exploratory/reports/<run>/REPORT.md"}\` (local, gitignored; attach the screenshot/trace when filing).`,
  ].join("\n");
  return { title, body };
}

/**
 * @param {{
 *   startedAt: string, finishedAt: string, baseUrl: string,
 *   budget: { actions: number, maxActions: number, elapsedMs: number, maxMs: number, exhaustedBy: string | null },
 *   findings: import("./findings.mjs").FindingStore,
 *   pages: Array<{ path: string, url: string, title?: string, visits: number, checked: boolean }>,
 *   actions: Array<{ index: number | null, scenario: string, description: string, outcome: string }>,
 *   scenarios: Array<{ name: string, status: string, note?: string }>,
 *   axe: Array<{ page: string, viewport: string, counts: Record<string, number>, violations: number }>,
 *   agent?: { status: string, note?: string, transcript?: string },
 *   notes?: string[],
 *   reportPath?: string,
 * }} data
 */
export function renderReport(data) {
  const { findings, budget } = data;
  const counts = findings.counts();
  const sorted = findings.sorted();
  const bugs = findings.bugs();
  const lines = [];

  lines.push("# Exploratory bug-bash report", "");
  lines.push(`- Started: ${data.startedAt}`);
  lines.push(`- Finished: ${data.finishedAt}`);
  lines.push(`- Target: ${data.baseUrl} (isolated smoke stack, database \`meperpos_playwright\`)`);
  lines.push(
    `- Budget used: ${budget.actions}/${budget.maxActions} actions after login, ${minutes(budget.elapsedMs)} of ${minutes(budget.maxMs)}${budget.exhaustedBy ? ` — stopped: ${budget.exhaustedBy} budget exhausted` : ""}`,
  );
  lines.push(
    `- Findings: ${SEVERITIES.map((s) => `${counts[s]} ${s}`).join(", ")} (${bugs.length} with an issue draft)`,
  );
  if (data.agent) lines.push(`- LLM pass (\`--agent\`): ${data.agent.status}${data.agent.note ? ` — ${data.agent.note}` : ""}`);
  for (const note of data.notes ?? []) lines.push(`- Note: ${note}`);
  lines.push("");

  lines.push("## Findings", "");
  if (sorted.length === 0) {
    lines.push("No findings in this run. Coverage is listed below.", "");
  } else {
    lines.push("| ID | Severity | Title | Page(s) | Layer |", "| --- | --- | --- | --- | --- |");
    for (const finding of sorted) {
      lines.push(
        `| ${finding.id} | ${finding.severity} | ${escapeCell(finding.title)} | ${escapeCell(finding.urls.join(", "))} | ${LAYERS[finding.layer] ?? finding.layer} |`,
      );
    }
    lines.push("");
    for (const finding of sorted) lines.push(findingSection(finding));
  }

  lines.push("## Coverage", "");
  lines.push("### Pages visited", "");
  lines.push("| Page | URL | Visits | Checked (axe/layout) |", "| --- | --- | --- | --- |");
  for (const page of data.pages) {
    lines.push(`| ${escapeCell(page.path)} | ${escapeCell(page.url)} | ${page.visits} | ${page.checked ? "yes" : "no"} |`);
  }
  lines.push("");

  lines.push("### Scenarios", "");
  lines.push("| Scenario | Status | Note |", "| --- | --- | --- |");
  for (const scenario of data.scenarios) {
    lines.push(`| ${escapeCell(scenario.name)} | ${scenario.status} | ${escapeCell(scenario.note ?? "")} |`);
  }
  lines.push("");

  lines.push("### Actions", "");
  lines.push("Numbered actions count against the budget; `-` marks the sign-in and checks, which do not.", "");
  lines.push("| # | Scenario | Action | Outcome |", "| --- | --- | --- | --- |");
  for (const action of data.actions) {
    lines.push(
      `| ${action.index ?? "-"} | ${escapeCell(action.scenario)} | ${escapeCell(action.description)} | ${escapeCell(action.outcome)} |`,
    );
  }
  lines.push("");

  lines.push("### axe summary", "");
  lines.push(
    "Serious and critical violations become findings; moderate and minor are counted here only.",
    "",
  );
  lines.push("| Page | Viewport | critical | serious | moderate | minor |", "| --- | --- | --- | --- | --- | --- |");
  for (const entry of data.axe) {
    const c = entry.counts;
    lines.push(
      `| ${escapeCell(entry.page)} | ${entry.viewport} | ${c.critical ?? 0} | ${c.serious ?? 0} | ${c.moderate ?? 0} | ${c.minor ?? 0} |`,
    );
  }
  lines.push("");

  if (data.agent) {
    lines.push("## LLM pass", "");
    lines.push(`Status: ${data.agent.status}${data.agent.note ? ` — ${data.agent.note}` : ""}`);
    if (data.agent.transcript) lines.push("", `Transcript: [${data.agent.transcript}](${data.agent.transcript})`);
    lines.push("");
  }

  lines.push("## Draft GitHub issues", "");
  if (bugs.length === 0) {
    lines.push("None: no finding above `info`.", "");
  } else {
    lines.push(
      "Not filed. Review them, then file the ones that are real bugs with `npm run explore:file-issues -- <this report dir>` (opt-in; `--dry-run` prints without creating).",
      "",
    );
    for (const finding of bugs) {
      const draft = issueDraft(finding, { reportPath: data.reportPath });
      lines.push(`### ${finding.id}: ${draft.title}`, "", "```markdown", draft.body, "```", "");
    }
  }

  return lines.join("\n");
}

/**
 * Writes REPORT.md, findings.json and run.json. Each file is written on its
 * own, smallest first, so one failed write (a full disk) does not cost the
 * others. Never throws; returns the files that could not be written.
 *
 * @param {string} reportDir
 * @param {Parameters<typeof renderReport>[0]} data
 * @param {Record<string, unknown>} run extra fields for run.json
 * @returns {Array<{ file: string, error: string }>}
 */
export function writeRunFiles(reportDir, data, run) {
  const files = [
    [
      "findings.json",
      () => `${JSON.stringify({ generatedAt: data.finishedAt, findings: data.findings.sorted() }, null, 2)}\n`,
    ],
    ["REPORT.md", () => renderReport(data)],
    ["run.json", () => `${JSON.stringify(run, null, 2)}\n`],
  ];
  const errors = [];
  for (const [file, render] of files) {
    try {
      writeFileSync(join(reportDir, file), render());
    } catch (error) {
      errors.push({ file, error: String(error?.message ?? error).split("\n")[0] });
    }
  }
  return errors;
}
