import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Budget, BudgetExhausted } from "./budget.mjs";
import { FindingStore, atLeast, axeSeverity, normalizeForKey, suggestLayer } from "./findings.mjs";
import { issueDraft, renderReport, writeRunFiles } from "./report.mjs";
import { ExplorerSession, isPreSignInAuthProbe } from "./session.mjs";
import { fileIssues, issueCommands } from "./issues.mjs";
import { EXPLORE_SEED } from "../seed.mjs";

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("budget stops at the action cap", () => {
  const budget = new Budget({ maxActions: 2, maxMs: 60_000 });
  assert.equal(budget.spend(), 1);
  assert.equal(budget.spend(), 2);
  assert.throws(() => budget.spend(), BudgetExhausted);
  assert.equal(budget.summary().exhaustedBy, "actions");
  assert.equal(budget.summary().actions, 2);
});

test("budget stops at the time cap", () => {
  let now = 0;
  const budget = new Budget({ maxActions: 100, maxMs: 1000, now: () => now });
  budget.spend();
  now = 1000;
  assert.equal(budget.exhausted(), "time");
  assert.throws(() => budget.spend(), BudgetExhausted);
  assert.equal(budget.summary().exhaustedBy, "time");
});

test("budget rejects nonsense limits", () => {
  assert.throws(() => new Budget({ maxActions: 0, maxMs: 1000 }));
  assert.throws(() => new Budget({ maxActions: 5, maxMs: -1 }));
});

test("severity helpers order and map axe impacts", () => {
  assert.ok(atLeast("critical", "high"));
  assert.ok(atLeast("high", "high"));
  assert.ok(!atLeast("low", "medium"));
  assert.equal(axeSeverity("critical"), "high");
  assert.equal(axeSeverity("serious"), "medium");
  assert.equal(axeSeverity("moderate"), null);
});

test("layer suggestions follow the trust stack", () => {
  assert.equal(suggestLayer("validation").layer, "01");
  assert.equal(suggestLayer("server-error").layer, "01");
  assert.equal(suggestLayer("console-error").layer, "02");
  assert.equal(suggestLayer("a11y").layer, "02");
  assert.equal(suggestLayer("copy").layer, "03");
});

test("repeats of one defect fold into a single finding", () => {
  assert.equal(normalizeForKey("GET /api/sales/123?page=2"), "GET /api/sales/:n");
  const store = new FindingStore();
  const first = store.add({ title: "500 on GET /api/sales/1", severity: "medium", category: "http-error", url: "/sales" });
  store.add({ title: "500 on GET /api/sales/2", severity: "high", category: "http-error", url: "/reports" });
  assert.equal(store.items.length, 1);
  assert.equal(first.occurrences, 2);
  assert.equal(first.severity, "high");
  assert.deepEqual(first.urls, ["/sales", "/reports"]);
  assert.equal(first.layer, "02");
});

test("findings require the fields the report needs", () => {
  const store = new FindingStore();
  assert.throws(() => store.add({ title: "x", severity: "high", category: "a11y" }), /url/);
  assert.throws(() => store.add({ title: "x", severity: "urgent", category: "a11y", url: "/" }), /severity/);
});

function sampleData(store) {
  return {
    startedAt: "2026-11-21T00:00:00.000Z",
    finishedAt: "2026-11-21T00:08:00.000Z",
    baseUrl: "http://127.0.0.1:3100",
    budget: { actions: 12, maxActions: 50, elapsedMs: 480_000, maxMs: 600_000, exhaustedBy: null },
    findings: store,
    pages: [{ path: "/sales", url: "http://127.0.0.1:3100/sales", visits: 2, checked: true }],
    actions: [{ index: 1, scenario: "sales", description: "open /sales", outcome: "ok" }],
    scenarios: [{ name: "sales", status: "done" }],
    axe: [{ page: "/sales", viewport: "desktop", counts: { serious: 1 }, violations: 1 }],
  };
}

test("an empty run still reports coverage", () => {
  const markdown = renderReport(sampleData(new FindingStore()));
  assert.match(markdown, /No findings in this run/);
  assert.match(markdown, /### Pages visited/);
  assert.match(markdown, /\| \/sales \| http:\/\/127\.0\.0\.1:3100\/sales \| 2 \| yes \|/);
  assert.match(markdown, /12\/50 actions/);
  assert.match(markdown, /None: no finding above `info`/);
});

test("a finding renders with severity, layer, steps, evidence and an issue draft", () => {
  const store = new FindingStore();
  store.add({
    title: "Product accepted with a negative sale price",
    severity: "high",
    category: "validation",
    url: "/inventory",
    steps: ["Open /inventory", "Create a product with sale price -1"],
    expected: "400",
    actual: "201",
    evidence: { screenshot: "screenshots/F01.png", network: [{ method: "POST", url: "/api/products", status: 201 }] },
  });
  store.add({ title: "Could not find the filter", severity: "info", category: "coverage", url: "/sales" });
  const markdown = renderReport(sampleData(store));
  assert.match(markdown, /### F01 — Product accepted with a negative sale price/);
  assert.match(markdown, /Severity: \*\*high\*\*/);
  assert.match(markdown, /Suggested layer: \*\*01 types\/boundaries\*\*/);
  assert.match(markdown, /1\. Open \/inventory/);
  assert.match(markdown, /screenshots\/F01\.png/);
  assert.match(markdown, /### F01: \[bug-bash\] Product accepted/);
  // Info findings are listed but get no issue draft.
  assert.doesNotMatch(markdown, /F02: \[bug-bash\]/);
});

test("issue drafts and gh commands skip info and honour the threshold", () => {
  const store = new FindingStore();
  store.add({ title: "High one", severity: "high", category: "server-error", url: "/pos" });
  store.add({ title: "Low one", severity: "low", category: "layout", url: "/pos" });
  store.add({ title: "Info one", severity: "info", category: "coverage", url: "/pos" });
  const draft = issueDraft(store.items[0]);
  assert.equal(draft.title, "[bug-bash] High one");
  assert.match(draft.body, /01 types\/boundaries/);
  assert.deepEqual(issueCommands(store.items).map((c) => c.id), ["F01", "F02"]);
  assert.deepEqual(issueCommands(store.items, { minSeverity: "medium" }).map((c) => c.id), ["F01"]);
  const [command] = issueCommands(store.items, { repo: "owner/repo" });
  assert.deepEqual(command.args.slice(0, 3), ["issue", "create", "--title"]);
  assert.deepEqual(command.args.slice(-2), ["--repo", "owner/repo"]);
});

test("file-issues --dry-run plans without calling gh", () => {
  const dir = mkdtempSync(join(tmpdir(), "explore-issues-"));
  try {
    const store = new FindingStore();
    store.add({ title: "High one", severity: "high", category: "server-error", url: "/pos" });
    writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: store.items }));
    const logged = [];
    const result = fileIssues(dir, { dryRun: true, log: (line) => logged.push(line) });
    assert.equal(result.created, 0);
    assert.match(logged.join("\n"), /\(dry run\) would run: gh issue create --title "\[bug-bash\] High one"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run notes (skipped traces, partial runs) show in the report header", () => {
  const markdown = renderReport({
    ...sampleData(new FindingStore()),
    notes: ["Traces skipped: 0.4 GiB free on the report volume (under 1 GiB)."],
  });
  assert.match(markdown, /- Note: Traces skipped: 0\.4 GiB free/);
  assert.doesNotMatch(renderReport(sampleData(new FindingStore())), /- Note:/);
});

test("writeRunFiles writes REPORT.md, findings.json and run.json and reports per-file failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "explore-write-"));
  try {
    const store = new FindingStore();
    store.add({ title: "High one", severity: "high", category: "server-error", url: "/pos" });
    const errors = writeRunFiles(dir, sampleData(store), { counts: store.counts() });
    assert.deepEqual(errors, []);
    assert.match(readFileSync(join(dir, "REPORT.md"), "utf8"), /# Exploratory bug-bash report/);
    assert.equal(JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0].title, "High one");
    assert.equal(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")).counts.high, 1);
    // A directory where a file should go makes that one write fail; the others still land.
    rmSync(join(dir, "findings.json"));
    mkdirSync(join(dir, "findings.json"));
    rmSync(join(dir, "REPORT.md"));
    const partial = writeRunFiles(dir, sampleData(store), {});
    assert.deepEqual(partial.map((e) => e.file), ["findings.json"]);
    assert.match(readFileSync(join(dir, "REPORT.md"), "utf8"), /High one/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeSession(dir, tracing, options = {}) {
  const page = { on() {}, url: () => "http://127.0.0.1:3100/" };
  return new ExplorerSession({
    context: { tracing },
    page,
    baseUrl: "http://127.0.0.1:3100",
    reportDir: dir,
    budget: new Budget({ maxActions: 5, maxMs: 60_000 }),
    findings: new FindingStore(),
    log: () => {},
    ...options,
  });
}

test("a trace that cannot be saved (ENOSPC) does not stop the run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "explore-trace-"));
  try {
    const enospc = Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    const calls = [];
    const session = fakeSession(dir, {
      async startChunk() {
        calls.push("start");
      },
      async stopChunk() {
        calls.push("stop");
        throw enospc;
      },
    });
    await session.scenario("first", async (s) => s.record({ title: "Broke", severity: "high", category: "server-error" }));
    await session.scenario("second", async () => {});
    assert.deepEqual(session.scenarios.map((s) => s.status), ["done", "done"]);
    // After a disk-full failure traces are switched off for the rest of the run.
    assert.deepEqual(calls, ["start", "stop"]);
    assert.equal(session.findings.items[0].evidence.trace, undefined);
    assert.match(session.traceNote, /ENOSPC/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a trace chunk that cannot start does not stop the scenario", async () => {
  const dir = mkdtempSync(join(tmpdir(), "explore-trace-"));
  try {
    const session = fakeSession(dir, {
      async startChunk() {
        throw new Error("Tracing has not been started");
      },
      async stopChunk() {
        throw new Error("must not be called");
      },
    });
    let ran = false;
    await session.scenario("only", async () => {
      ran = true;
    });
    assert.ok(ran);
    assert.equal(session.scenarios[0].status, "done");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with traces off the session never touches tracing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "explore-trace-"));
  try {
    const session = fakeSession(
      dir,
      {
        async startChunk() {
          throw new Error("must not be called");
        },
      },
      { traces: false },
    );
    await session.scenario("only", async (s) => s.record({ title: "Broke", severity: "high", category: "server-error" }));
    assert.equal(session.scenarios[0].status, "done");
    assert.equal(session.findings.items[0].evidence.trace, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the explorer's seed mirror matches fixtures/seed.ts", () => {
  const source = readFileSync(join(e2eDir, "fixtures", "seed.ts"), "utf8");
  for (const value of [
    EXPLORE_SEED.owner.email,
    EXPLORE_SEED.owner.password,
    EXPLORE_SEED.category,
    EXPLORE_SEED.coffee.name,
    EXPLORE_SEED.coffee.sku,
  ]) {
    assert.ok(source.includes(`"${value}"`), `fixtures/seed.ts no longer contains "${value}"`);
  }
});

test("pre-sign-in session probes on /auth/refresh and /auth/me are not findings (401 or CSRF 403)", () => {
  // No cookies yet: the CSRF guard answers the anonymous refresh with 403 before the handler's 401.
  assert.equal(isPreSignInAuthProbe({ status: 403, path: "/api/auth/refresh", signedIn: false }), true);
  assert.equal(isPreSignInAuthProbe({ status: 401, path: "/api/auth/refresh", signedIn: false }), true);
  assert.equal(isPreSignInAuthProbe({ status: 401, path: "/api/auth/me", signedIn: false }), true);
});

test("auth probe failures still count once signed in, and other statuses or routes always count", () => {
  assert.equal(isPreSignInAuthProbe({ status: 403, path: "/api/auth/refresh", signedIn: true }), false);
  assert.equal(isPreSignInAuthProbe({ status: 401, path: "/api/auth/refresh", signedIn: true }), false);
  assert.equal(isPreSignInAuthProbe({ status: 500, path: "/api/auth/refresh", signedIn: false }), false);
  assert.equal(isPreSignInAuthProbe({ status: 403, path: "/api/auth/login", signedIn: false }), false);
  assert.equal(isPreSignInAuthProbe({ status: 403, path: "/api/products", signedIn: false }), false);
});
