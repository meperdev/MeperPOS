/**
 * One exploratory browser session: wraps every action so it counts against the
 * budget, records repro steps, and collects console, page-error, network, axe
 * and layout evidence into the finding store.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { BudgetExhausted } from "./budget.mjs";
import { axeSeverity, severityRank } from "./findings.mjs";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Browser noise that is not a defect of the app under test. */
function ignoredRequestFailure(failure) {
  return /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure ?? "");
}

function shortError(error) {
  return String(error?.message ?? error).split("\n")[0].slice(0, 200);
}

export class ExplorerSession {
  /**
   * @param {{
   *   context: import("@playwright/test").BrowserContext,
   *   page: import("@playwright/test").Page,
   *   baseUrl: string, reportDir: string,
   *   budget: import("./budget.mjs").Budget,
   *   findings: import("./findings.mjs").FindingStore,
   *   log: (message: string) => void,
   * }} options
   */
  constructor({ context, page, baseUrl, reportDir, budget, findings, log, traces = true }) {
    Object.assign(this, { context, page, baseUrl, reportDir, budget, findings, log });
    this.origin = new URL(baseUrl).origin;
    this.screenshotDir = join(reportDir, "screenshots");
    this.traceDir = join(reportDir, "traces");
    mkdirSync(this.screenshotDir, { recursive: true });
    /**
     * Traces are best-effort evidence: the first failure to save one turns
     * them off for the rest of the run, and `traceNote` says why for the report.
     */
    this.traces = traces;
    this.traceNote = null;
    if (traces) mkdirSync(this.traceDir, { recursive: true });
    /** Budget does not apply until the sign-in is done. */
    this.signedIn = false;
    this.actions = [];
    this.pages = new Map();
    this.axe = [];
    this.scenarios = [];
    this.mobileChecked = new Set();
    this.current = null;
    this.window = null;
    this.screenshotCount = 0;
    this.attach(page);
  }

  /** Route of the current page, without origin. */
  path() {
    try {
      const url = new URL(this.page.url());
      return url.pathname + url.search;
    } catch {
      return this.page.url();
    }
  }

  attach(page) {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // The browser echoes every failed resource as a console error; the
      // response listener already classifies those with their status.
      if (/^Failed to load resource/.test(text)) return;
      this.window?.console.push(text);
      this.record({
        title: `Console error: ${text.split("\n")[0].slice(0, 140)}`,
        severity: "medium",
        category: "console-error",
        evidence: { console: [text] },
      });
    });
    page.on("pageerror", (error) => {
      this.record({
        title: `Uncaught exception: ${shortError(error)}`,
        severity: "high",
        category: "page-error",
        evidence: { console: [String(error?.stack ?? error).slice(0, 1000)] },
      });
    });
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.startsWith(this.origin)) return;
      const status = response.status();
      const request = response.request();
      const path = url.slice(this.origin.length);
      const entry = { method: request.method(), url: path, status };
      if (path.startsWith("/api/") && status >= 400) {
        try {
          entry.body = (await response.text()).slice(0, 300);
        } catch {
          // Body not available (redirect, aborted).
        }
      }
      this.window?.network.push(entry);
      if (status < 400) return;
      // Before sign-in the app probes /auth/refresh and /auth/me; 401 there is the design.
      if (status === 401 && /\/api\/auth\/(refresh|me)\b/.test(path) && !this.signedIn) return;
      if (this.window?.expected.includes(status)) {
        entry.expected = true;
        return;
      }
      const server = status >= 500;
      this.record({
        title: `${server ? "Server error" : `Unexpected ${status}`} on ${entry.method} ${path.replace(/\?.*$/, "")}`,
        severity: server ? "high" : "medium",
        category: server ? "server-error" : "http-error",
        actual: `${status}${entry.body ? `: ${entry.body}` : ""}`,
        evidence: { network: [entry] },
      });
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText;
      if (!request.url().startsWith(this.origin) || ignoredRequestFailure(failure)) return;
      const path = request.url().slice(this.origin.length);
      this.record({
        title: `Request failed: ${request.method()} ${path.replace(/\?.*$/, "")} (${failure})`,
        severity: "medium",
        category: "request-failed",
        evidence: { network: [{ method: request.method(), url: path, status: failure }] },
      });
    });
  }

  /** Adds a finding tied to the current page and the steps taken so far in this scenario. */
  record(finding) {
    const stored = this.findings.add({
      url: this.path(),
      scenario: this.current?.name,
      steps: [...(this.current?.steps ?? [])],
      ...finding,
    });
    if (this.current && !this.current.findings.includes(stored)) this.current.findings.push(stored);
    this.window?.findings.push(stored);
    return stored;
  }

  async screenshot(name) {
    this.screenshotCount += 1;
    const file = `screenshots/${String(this.screenshotCount).padStart(3, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60)}.png`;
    try {
      await this.page.screenshot({ path: join(this.reportDir, file), timeout: 5_000 });
      return file;
    } catch {
      return undefined;
    }
  }

  /** Runs one scenario inside its own trace chunk; the chunk is kept only if it found something. */
  async scenario(name, fn) {
    if (this.budget.exhausted() && this.signedIn) {
      this.budget.exhaustedBy ??= this.budget.exhausted();
      this.scenarios.push({ name, status: "skipped", note: `${this.budget.exhausted()} budget exhausted` });
      return;
    }
    this.current = { name, steps: [], findings: [] };
    let tracing = false;
    if (this.traces) {
      try {
        await this.context.tracing.startChunk({ title: name });
        tracing = true;
      } catch (error) {
        this.disableTraces(`could not start the trace for ${name}: ${shortError(error)}`);
      }
    }
    let status = "done";
    let note;
    try {
      await fn(this);
    } catch (error) {
      if (error instanceof BudgetExhausted) {
        status = "stopped";
        note = error.message;
      } else {
        status = "crashed";
        note = shortError(error);
        this.record({
          title: `Explorer scenario "${name}" crashed: ${note}`,
          severity: "info",
          category: "coverage",
          evidence: { details: "A defect in the explorer or an unexpected page state; see the trace." },
        });
      }
    }
    if (tracing) {
      const tracePath = `traces/${name.replace(/[^a-z0-9-]+/gi, "-")}.zip`;
      const keep = this.current.findings.some((finding) => finding.severity !== "info") || status === "crashed";
      try {
        await this.context.tracing.stopChunk(keep ? { path: join(this.reportDir, tracePath) } : undefined);
        if (keep) {
          for (const finding of this.current.findings) finding.evidence.trace ??= tracePath;
        }
      } catch (error) {
        this.disableTraces(`could not save the trace for ${name}: ${shortError(error)}`);
      }
    }
    this.scenarios.push({ name, status, note });
    this.current = null;
  }

  /** Turns traces off for the rest of the run; screenshots and findings carry on. */
  disableTraces(reason) {
    this.log(`${reason}; traces are off for the rest of the run`);
    this.traces = false;
    this.traceNote ??= `Traces stopped (best-effort): ${reason}.`;
  }

  /**
   * One user action. Counts against the budget once signed in (unless `free`),
   * becomes a repro step, and collects the network traffic it caused.
   * A missing control is recorded as a coverage gap, not a crash.
   *
   * @returns {Promise<{ ok: boolean, network: Array<Record<string, any>> }>}
   */
  async act(description, fn, { expectStatuses = [], free = false, settleMs = 400 } = {}) {
    const index = this.signedIn && !free ? this.budget.spend() : null;
    this.current?.steps.push(description);
    this.window = { expected: expectStatuses, network: [], console: [], findings: [] };
    const window = this.window;
    let outcome = "ok";
    let ok = true;
    try {
      await fn(this.page);
      await this.settle(settleMs);
    } catch (error) {
      if (error instanceof BudgetExhausted) throw error;
      ok = false;
      outcome = `could not do it: ${shortError(error)}`;
      this.record({
        title: `Could not exercise: ${description}`,
        severity: "info",
        category: "coverage",
        key: `coverage|${this.current?.name}|${description}`,
        actual: shortError(error),
      });
    }
    const expectedHits = window.network.filter((entry) => entry.expected);
    if (expectedHits.length) {
      outcome += ` (expected ${expectedHits.map((e) => `${e.status} ${e.method} ${e.url.replace(/\?.*$/, "")}`).join(", ")})`;
    }
    const needsScreenshot = window.findings.filter(
      (finding) => severityRank(finding.severity) <= severityRank("low") && !finding.evidence.screenshot,
    );
    if (needsScreenshot.length) {
      const file = await this.screenshot(`${this.current?.name ?? "action"}-${description}`);
      for (const finding of needsScreenshot) finding.evidence.screenshot = file;
    }
    this.actions.push({ index, scenario: this.current?.name ?? "-", description, outcome });
    this.window = null;
    return { ok, network: window.network };
  }

  async settle(extraMs) {
    try {
      await this.page.waitForLoadState("networkidle", { timeout: 5_000 });
    } catch {
      // Long-polling pages never go idle; the pause below is enough.
    }
    await this.page.waitForTimeout(extraMs);
  }

  /** Navigates and registers the page in the coverage table. */
  async visit(path, options = {}) {
    const result = await this.act(`Open ${path}`, (page) => page.goto(path), options);
    const key = new URL(this.page.url()).pathname;
    const entry = this.pages.get(key) ?? { path: key, url: this.page.url(), visits: 0, checked: false };
    entry.visits += 1;
    this.pages.set(key, entry);
    return result;
  }

  /**
   * Server-side validation oracle: after submitting input the server must
   * reject, a 2xx on the matching request is a finding.
   */
  expectRejected(network, { match, caseLabel, expected, severity = "high" }) {
    const hits = network.filter(match);
    if (hits.length === 0) return "blocked before reaching the server";
    const accepted = hits.find((entry) => entry.status < 400);
    if (accepted) {
      const path = accepted.url.replace(/\?.*$/, "");
      this.record({
        title: `Server accepted ${caseLabel}`,
        severity,
        category: "validation",
        key: `validation|${accepted.method} ${path}|${caseLabel}`,
        expected: expected ?? "The API rejects it with 400 and the form shows the error.",
        actual: `${accepted.method} ${path} answered ${accepted.status}.`,
        evidence: { network: hits },
      });
      return `accepted (${accepted.status})`;
    }
    return `rejected by the server (${hits.map((h) => h.status).join(", ")})`;
  }

  /** axe + layout + typography + copy checks of the current page. Free: not a user action. */
  async check(label = this.path()) {
    const key = new URL(this.page.url()).pathname;
    const pageEntry = this.pages.get(key);
    const steps = [...(this.current?.steps ?? [])];
    await this.axeCheck(label, "desktop", steps);
    await this.layoutCheck(label, "desktop", steps);
    if (!this.mobileChecked.has(key)) {
      this.mobileChecked.add(key);
      await this.page.setViewportSize(MOBILE);
      await this.page.waitForTimeout(400);
      await this.layoutCheck(label, "mobile 390px", [...steps, "Resize the window to 390x844 (phone)"]);
      await this.page.setViewportSize(DESKTOP);
      await this.page.waitForTimeout(200);
    }
    if (pageEntry) pageEntry.checked = true;
    this.actions.push({ index: null, scenario: this.current?.name ?? "-", description: `Check ${label} (axe, layout, typography, copy)`, outcome: "done" });
  }

  async axeCheck(label, viewport, steps) {
    let results;
    try {
      results = await new AxeBuilder({ page: this.page }).withTags(AXE_TAGS).analyze();
    } catch (error) {
      this.axe.push({ page: label, viewport, counts: {}, violations: 0, error: shortError(error) });
      return;
    }
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const violation of results.violations) {
      counts[violation.impact ?? "minor"] = (counts[violation.impact ?? "minor"] ?? 0) + 1;
      const severity = axeSeverity(violation.impact);
      if (!severity) continue;
      this.record({
        title: `Accessibility: ${violation.help} (${violation.id})`,
        severity,
        category: "a11y",
        key: `a11y|${violation.id}`,
        steps: [...steps, "Run axe (WCAG 2.1 A/AA) on the page"],
        evidence: {
          axe: {
            id: violation.id,
            impact: violation.impact,
            count: violation.nodes.length,
            nodes: violation.nodes.map((node) => node.target.join(" ")),
            helpUrl: violation.helpUrl,
          },
        },
      });
    }
    this.axe.push({ page: label, viewport, counts, violations: results.violations.length });
  }

  async layoutCheck(label, viewport, steps) {
    let report;
    try {
      report = await this.page.evaluate(inspectLayout);
    } catch (error) {
      this.log(`layout check failed on ${label}: ${shortError(error)}`);
      return;
    }
    if (report.overflow > 1) {
      const file = await this.screenshot(`overflow-${viewport}-${label}`);
      this.record({
        title: `Horizontal overflow on ${new URL(this.page.url()).pathname} at ${viewport}`,
        severity: "low",
        category: "layout",
        key: `layout|${new URL(this.page.url()).pathname}|${viewport}`,
        steps,
        expected: "The page fits the viewport width; no horizontal scrollbar.",
        actual: `The document is ${report.overflow}px wider than the viewport.`,
        evidence: { screenshot: file, details: `Widest offenders: ${report.offenders.join("; ") || "(not identified)"}` },
      });
    }
    if (viewport !== "desktop") return;
    if (report.tinyText.length) {
      this.record({
        title: "Text below the 12px floor",
        severity: "low",
        category: "typography",
        key: "typography|tiny-text",
        steps,
        expected: "AGENTS.md: text-xs (12px) is the floor; no text-[10px] or text-[11px].",
        actual: `${report.tinyText.length} visible element(s) render under 12px.`,
        evidence: { details: report.tinyText.slice(0, 5).join("; ") },
      });
    }
    if (report.titleCase.length) {
      this.record({
        title: "UI copy in Title Case instead of sentence case",
        severity: "low",
        category: "copy",
        key: "copy|title-case",
        steps,
        expected: "AGENTS.md: actions, titles and labels in sentence case (`Nuevo cliente`).",
        actual: report.titleCase.slice(0, 5).map((t) => `"${t}"`).join(", "),
      });
    }
    if (report.exclamations.length) {
      this.record({
        title: "Exclamation marks in UI chrome",
        severity: "low",
        category: "copy",
        key: "copy|exclamation",
        steps,
        expected: "AGENTS.md: no exclamation marks in chrome.",
        actual: report.exclamations.slice(0, 5).map((t) => `"${t}"`).join(", "),
      });
    }
  }
}

/**
 * Runs in the page. Cheap heuristics only: horizontal overflow and who causes
 * it, visible text under 12px, Title Case and exclamation marks in chrome.
 */
function inspectLayout() {
  const width = window.innerWidth;
  const overflow = document.documentElement.scrollWidth - width;
  const describe = (el) => {
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid=${testId}]`;
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    return `${el.tagName.toLowerCase()}${id}${cls === "." ? "" : cls}${text ? ` "${text}"` : ""}`;
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
  };
  const offenders = [];
  if (overflow > 1) {
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.right > width + 1 && visible(el)) {
        // Report the outermost offender only.
        if (!offenders.some((o) => o.el.contains(el))) offenders.push({ el, right: rect.right });
      }
      if (offenders.length >= 3) break;
    }
  }
  const tinyText = [];
  const titleCase = [];
  const exclamations = [];
  const acronym = /^[A-ZÁÉÍÓÚÑ0-9]{2,}$/;
  const stop = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "a", "en", "por", "con", "para", "al"]);
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (!ownText) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11.5 && tinyText.length < 10) tinyText.push(`${describe(el)} (${size}px)`);
    if (!el.matches("h1, h2, h3, h4, button, [role=tab], th, label, a[role=button]")) continue;
    if (el.closest("[data-testid*=receipt], table tbody")) continue;
    if (/!|¡/.test(ownText) && exclamations.length < 10) exclamations.push(ownText.slice(0, 60));
    if (/\d/.test(ownText)) continue;
    const words = ownText.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) continue;
    const rest = words.slice(1).filter((w) => !stop.has(w) && !acronym.test(w) && /^\p{L}/u.test(w));
    if (rest.length >= 1 && rest.every((w) => /^\p{Lu}\p{Ll}/u.test(w)) && titleCase.length < 10) {
      titleCase.push(ownText.slice(0, 60));
    }
  }
  return {
    overflow,
    offenders: offenders.map((o) => `${describe(o.el)} (right edge ${Math.round(o.right)}px)`),
    tinyText,
    titleCase,
    exclamations,
  };
}

export { DESKTOP, MOBILE };
