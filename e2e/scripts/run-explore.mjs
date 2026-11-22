#!/usr/bin/env node
/**
 * Exploratory bug bash (e2e/README.md, "Exploratory bug bash"):
 *
 *   1. start the isolated stack (scripts/stack.mjs; the database guard refuses
 *      anything but meperpos_playwright on a loopback port other than 5432)
 *   2. sign in as the e2e seed owner and run the scripted scenarios
 *      (exploratory/scenarios.mjs) under an action + wall-clock budget
 *   3. optionally (`--agent`) let an LLM drive a few more browser steps
 *   4. write exploratory/reports/<run>/REPORT.md, findings.json and run.json,
 *      with screenshots, traces and stack logs next to them (gitignored);
 *      the report is written in a `finally`, so a run that fails midway still
 *      leaves a partial one, and traces are best-effort (skipped under 1 GiB
 *      free, switched off after the first one that cannot be saved)
 *   5. stop the apps and the Playwright Postgres, always
 *
 * Exit codes: 0 when the run completed, findings or not (this is a bug bash,
 * not a gate); 1 when the stack, the sign-in or the runner itself failed;
 * 2 for bad arguments.
 */

import { mkdirSync, statfsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createStack, e2eDir } from "./stack.mjs";
import { Budget } from "../exploratory/lib/budget.mjs";
import { FindingStore, SEVERITIES } from "../exploratory/lib/findings.mjs";
import { writeRunFiles } from "../exploratory/lib/report.mjs";
import { fileIssues } from "../exploratory/lib/issues.mjs";
import { DESKTOP, ExplorerSession } from "../exploratory/lib/session.mjs";
import { runAgentPass } from "../exploratory/lib/agent.mjs";
import { SCENARIOS, login } from "../exploratory/scenarios.mjs";
import { EXPLORE_SEED } from "../exploratory/seed.mjs";

const HELP = `Usage: npm run explore -- [options]

Budget (whichever runs out first stops the scripted run; the report is still written):
  --max-actions <n>     user actions after sign-in      (env EXPLORE_MAX_ACTIONS, default 60)
  --max-minutes <n>     wall-clock minutes for the run  (env EXPLORE_MAX_MINUTES, default 15)

Scope and output:
  --scenarios <a,b>     subset of: ${SCENARIOS.map(([name]) => name).join(", ")}
  --out <dir>           report directory (default exploratory/reports/<timestamp>)
  --headed              show the browser

Optional LLM pass (off by default; uses your signed-in OpenCode, no new keys):
  --agent               after the scripted run, let an LLM drive the browser
  --agent-steps <n>     hard cap on its tool calls     (default 25)
  --agent-minutes <n>   hard cap on its wall time      (default 5)
  --agent-model <p/m>   OpenCode model, provider/model (default: your OpenCode default)

GitHub issues (off by default; drafts are always in REPORT.md):
  --file-issues         file one issue per finding at or above --min-severity with gh
  --dry-run             with --file-issues: print what would be filed, create nothing
  --min-severity <s>    ${SEVERITIES.filter((s) => s !== "info").join("|")} (default medium)
  --repo <owner/name>   target repository for gh

Stack environment (scripts/stack.mjs): SMOKE_SKIP_BUILD=1, SMOKE_KEEP_DB=1, SMOKE_EXTERNAL_DB=1,
SMOKE_DATABASE_URL, SMOKE_BACKEND_PORT, SMOKE_FRONTEND_PORT.`;

function positiveNumber(name, raw, { integer = false } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new UsageError(`${name} must be a positive ${integer ? "integer" : "number"}, got "${raw}"`);
  }
  return value;
}

class UsageError extends Error {}

function readOptions(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "max-actions": { type: "string" },
      "max-minutes": { type: "string" },
      scenarios: { type: "string" },
      out: { type: "string" },
      headed: { type: "boolean", default: false },
      agent: { type: "boolean", default: false },
      "agent-steps": { type: "string", default: "25" },
      "agent-minutes": { type: "string", default: "5" },
      "agent-model": { type: "string" },
      "file-issues": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "min-severity": { type: "string", default: "medium" },
      repo: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  const known = SCENARIOS.map(([name]) => name);
  const scenarios = values.scenarios ? values.scenarios.split(",").map((s) => s.trim()).filter(Boolean) : known;
  const unknown = scenarios.filter((name) => !known.includes(name));
  if (unknown.length) throw new UsageError(`unknown scenario(s): ${unknown.join(", ")}; known: ${known.join(", ")}`);
  if (!SEVERITIES.includes(values["min-severity"])) {
    throw new UsageError(`--min-severity must be one of ${SEVERITIES.join(", ")}`);
  }
  if (values["dry-run"] && !values["file-issues"]) {
    throw new UsageError("--dry-run only applies to --file-issues");
  }
  return {
    help: values.help,
    maxActions: positiveNumber("--max-actions", values["max-actions"] ?? env.EXPLORE_MAX_ACTIONS ?? 60, { integer: true }),
    maxMinutes: positiveNumber("--max-minutes", values["max-minutes"] ?? env.EXPLORE_MAX_MINUTES ?? 15),
    scenarios,
    out: values.out,
    headed: values.headed,
    agent: values.agent,
    agentSteps: positiveNumber("--agent-steps", values["agent-steps"], { integer: true }),
    agentMinutes: positiveNumber("--agent-minutes", values["agent-minutes"]),
    agentModel: values["agent-model"],
    fileIssues: values["file-issues"],
    dryRun: values["dry-run"],
    minSeverity: values["min-severity"],
    repo: values.repo,
  };
}

function runId(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

function log(message) {
  console.log(`[explore] ${message}`);
}

let options;
try {
  options = readOptions(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`[explore] ${error.message}\n\n${HELP}`);
  process.exit(2);
}
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

const reportDir = options.out ? resolve(options.out) : join(e2eDir, "exploratory", "reports", runId());
mkdirSync(reportDir, { recursive: true });
const stack = createStack({ label: "explore", logDir: join(reportDir, "stack-logs") });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stack.down();
    process.exit(130);
  });
}

/** Under this much free space on the report volume, traces are skipped up front. */
const MIN_TRACE_BYTES = 1024 ** 3;

function freeBytes(dir) {
  try {
    const stats = statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/**
 * What the run has gathered so far. explore() fills it in; the report is
 * written from it in the outer `finally`, so a run that dies after the
 * scenarios started still leaves a (partial) report behind.
 */
const run = {
  startedAt: new Date().toISOString(),
  frontendUrl: null,
  budget: null,
  findings: null,
  session: null,
  signedIn: false,
  agent: undefined,
  notes: [],
};

async function explore() {
  const { frontendUrl, backendOrigin } = await stack.up();
  run.frontendUrl = frontendUrl;
  const maxMs = options.maxMinutes * 60_000;
  const budget = new Budget({ maxActions: options.maxActions, maxMs });
  const findings = new FindingStore();
  Object.assign(run, { budget, findings });
  log(`budget: ${options.maxActions} actions / ${options.maxMinutes} min; report: ${relative(process.cwd(), reportDir) || "."}`);

  // Traces are best-effort evidence; a nearly full disk must not cost the report.
  const free = freeBytes(reportDir);
  let traces = true;
  if (free !== null && free < MIN_TRACE_BYTES) {
    traces = false;
    run.notes.push(
      `Traces skipped: ${(free / 1024 ** 3).toFixed(2)} GiB free on the report volume (under 1 GiB); screenshots and findings only.`,
    );
    log(run.notes.at(-1));
  }

  const browser = await chromium.launch({ headless: !options.headed });
  // Last line of defence for the time budget: a hung action is bounded by
  // the timeouts below, but if the whole run overstays the budget by two
  // minutes the browser is closed, which fails whatever is pending.
  const watchdog = setTimeout(() => {
    log("wall-clock budget overrun by 2 min; closing the browser");
    budget.exhaustedBy ??= "time";
    browser.close().catch(() => {});
  }, maxMs + 120_000);
  try {
    const context = await browser.newContext({
      baseURL: frontendUrl,
      viewport: DESKTOP,
      locale: "es-CO",
      timezoneId: "America/Bogota",
      acceptDownloads: true,
    });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(30_000);
    if (traces) {
      try {
        await context.tracing.start({ screenshots: true, snapshots: true });
      } catch (error) {
        traces = false;
        run.notes.push(`Traces skipped: could not start tracing (${String(error?.message ?? error).split("\n")[0]}).`);
        log(run.notes.at(-1));
      }
    }
    const page = await context.newPage();
    const session = new ExplorerSession({ context, page, baseUrl: frontendUrl, reportDir, budget, findings, log, traces });
    run.session = session;

    await session.scenario("login", login);
    run.signedIn = session.signedIn;
    if (run.signedIn) {
      for (const [name, fn] of SCENARIOS) {
        if (!options.scenarios.includes(name)) continue;
        log(`scenario ${name} (actions used: ${budget.actions}/${budget.maxActions})`);
        await session.scenario(name, fn);
      }
    } else {
      log("could not sign in as the e2e seed owner; skipping the signed-in scenarios");
    }
    if (traces) await context.tracing.stop().catch(() => {});
    await context.close().catch(() => {});
  } finally {
    clearTimeout(watchdog);
    await browser.close().catch(() => {});
  }

  if (options.agent && run.signedIn) {
    const require = createRequire(import.meta.url);
    const result = await runAgentPass({
      reportDir,
      frontendUrl,
      backendOrigin,
      owner: EXPLORE_SEED.owner,
      visited: [...run.session.pages.keys()],
      maxSteps: options.agentSteps,
      maxMinutes: options.agentMinutes,
      model: options.agentModel,
      playwrightCli: join(dirname(require.resolve("playwright/package.json")), "cli.js"),
      log,
    });
    for (const finding of result.findings) findings.add(finding);
    run.agent = { status: result.status, note: result.note, transcript: result.transcript };
  } else if (options.agent) {
    run.agent = { status: "skipped", note: "the scripted sign-in failed" };
  }
}

/**
 * Writes REPORT.md, findings.json and run.json from whatever the run gathered.
 * Returns false when there was nothing to report (the stack never came up)
 * or a file could not be written.
 */
function writeReport(failure) {
  const { session, findings, budget } = run;
  if (!session) return false;
  const notes = [...run.notes];
  if (session.traceNote) notes.push(session.traceNote);
  if (failure) notes.push(`Partial report: the runner failed after the scenarios started (${failure}).`);
  const pages = [...session.pages.values()];
  const reportPath = join(reportDir, "REPORT.md");
  const data = {
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: run.frontendUrl,
    budget: budget.summary(),
    findings,
    pages,
    actions: session.actions,
    scenarios: session.scenarios,
    axe: session.axe,
    agent: run.agent,
    notes,
    reportPath: relative(join(e2eDir, ".."), reportPath),
  };
  const errors = writeRunFiles(reportDir, data, {
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    baseUrl: data.baseUrl,
    options: { ...options, help: undefined },
    budget: data.budget,
    counts: findings.counts(),
    pages,
    scenarios: session.scenarios,
    agent: run.agent,
    notes,
  });
  const counts = findings.counts();
  for (const { file, error } of errors) console.error(`[explore] could not write ${file}: ${error}`);
  if (errors.some(({ file }) => file === "REPORT.md")) {
    // Last resort: the findings must not exist only in memory.
    console.error("[explore] findings (REPORT.md could not be written):");
    for (const finding of findings.sorted()) {
      console.error(`[explore]   ${finding.id} ${finding.severity} [layer ${finding.layer}] ${finding.title} (${finding.urls.join(", ")})`);
    }
  } else {
    log(`report: ${reportPath}`);
  }
  log(`findings: ${SEVERITIES.map((s) => `${counts[s]} ${s}`).join(", ")}; pages: ${pages.map((p) => p.path).join(" ")}`);
  return errors.length === 0;
}

let exitCode = 1;
let failure = null;
try {
  await explore();
} catch (error) {
  console.error(`[explore] ${error.stack ?? error.message}`);
  failure = String(error?.message ?? error).split("\n")[0];
} finally {
  let written = false;
  try {
    written = writeReport(failure);
  } catch (error) {
    console.error(`[explore] could not write the report: ${error.stack ?? error.message}`);
  }
  if (written && !failure && options.fileIssues) {
    fileIssues(reportDir, { dryRun: options.dryRun, minSeverity: options.minSeverity, repo: options.repo });
  }
  // 0 for a completed run, findings or not; 1 when the stack, the sign-in,
  // the runner or the report write failed. A lost trace is not a failure.
  exitCode = written && !failure && run.signedIn ? 0 : 1;
  stack.down();
}
process.exit(exitCode);
