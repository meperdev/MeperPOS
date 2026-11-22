/**
 * Findings: what the explorer saw, classified by severity and by the
 * trust-stack layer a fix should be pushed to (AGENTS.md, "Bug -> rule loop").
 */

export const SEVERITIES = ["critical", "high", "medium", "low", "info"];

/** 01 types/boundaries, 02 lint/test, 03 AGENTS.md (prose). */
export const LAYERS = {
  "01": "01 types/boundaries",
  "02": "02 lint/test",
  "03": "03 AGENTS.md",
};

export function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  if (rank === -1) throw new Error(`unknown severity "${severity}"`);
  return rank;
}

/** True when `severity` is at least as bad as `threshold`. */
export function atLeast(severity, threshold) {
  return severityRank(severity) <= severityRank(threshold);
}

/** axe impact -> finding severity. Moderate/minor stay in the axe summary only. */
export function axeSeverity(impact) {
  switch (impact) {
    case "critical":
      return "high";
    case "serious":
      return "medium";
    default:
      return null;
  }
}

/**
 * Suggests the highest trust-stack layer that could hold a fix for a finding
 * of this kind. It is a starting point for the human triaging the report.
 */
export function suggestLayer(category) {
  switch (category) {
    // The server let bad input through or crashed on it: a DTO constraint,
    // a Prisma constraint or a guard makes it unrepresentable.
    case "server-error":
    case "validation":
      return {
        layer: "01",
        reason: "Make the bad input unrepresentable: a class-validator constraint on the DTO, a Prisma/DB constraint or a guard.",
      };
    // Client-side defects: pin them with a regression test or a lint rule.
    case "page-error":
    case "console-error":
    case "http-error":
    case "request-failed":
      return {
        layer: "02",
        reason: "Pin it with a regression test (smoke spec or unit test) once fixed; add a meperpos/* lint rule if the pattern is mechanical.",
      };
    case "a11y":
      return {
        layer: "02",
        reason: "Fix the markup and keep it fixed with an axe assertion in the smoke suite or a jsx-a11y lint rule.",
      };
    case "layout":
    case "typography":
      return {
        layer: "02",
        reason: "A lint rule over Tailwind classes (or a smoke assertion on overflow) can hold this mechanically.",
      };
    case "copy":
      return {
        layer: "03",
        reason: "Copy conventions (sentence case, no exclamation marks) live in AGENTS.md; promote to a lint rule if they keep recurring.",
      };
    default:
      return {
        layer: "03",
        reason: "Not mechanically checkable yet: describe the expectation in AGENTS.md or a skill.",
      };
  }
}

/** Collapses ids, numbers and query strings so repeats of one defect group together. */
export function normalizeForKey(text) {
  return String(text ?? "")
    .replace(/\?.*$/, "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":uuid")
    .replace(/\b[0-9a-z]{20,}\b/gi, ":id")
    .replace(/\d+/g, ":n")
    .slice(0, 300);
}

export class FindingStore {
  constructor() {
    /** @type {Array<Record<string, any>>} */
    this.items = [];
    this.byKey = new Map();
  }

  /**
   * Adds a finding, or folds it into an existing one with the same key
   * (counting occurrences and the pages it showed up on).
   *
   * Required: title, severity, category, url. Optional: key, steps, evidence,
   * expected, actual, scenario, layer, layerReason, source.
   */
  add(finding) {
    for (const field of ["title", "severity", "category", "url"]) {
      if (!finding[field]) throw new Error(`finding is missing "${field}"`);
    }
    severityRank(finding.severity);
    const key = finding.key ?? `${finding.category}|${normalizeForKey(finding.title)}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.urls.includes(finding.url)) existing.urls.push(finding.url);
      if (severityRank(finding.severity) < severityRank(existing.severity)) {
        existing.severity = finding.severity;
      }
      return existing;
    }
    const suggested = suggestLayer(finding.category);
    const stored = {
      id: `F${String(this.items.length + 1).padStart(2, "0")}`,
      source: "scripted",
      steps: [],
      evidence: {},
      ...finding,
      key,
      layer: finding.layer ?? suggested.layer,
      layerReason: finding.layerReason ?? suggested.reason,
      urls: [finding.url],
      occurrences: 1,
    };
    this.items.push(stored);
    this.byKey.set(key, stored);
    return stored;
  }

  /** Worst first, then in the order they were found. */
  sorted() {
    return [...this.items].sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id),
    );
  }

  /** Findings that deserve a GitHub issue draft: anything above info. */
  bugs() {
    return this.sorted().filter((finding) => finding.severity !== "info");
  }

  counts() {
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
    for (const finding of this.items) counts[finding.severity] += 1;
    return counts;
  }
}
