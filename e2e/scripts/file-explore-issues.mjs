#!/usr/bin/env node
/**
 * Files GitHub issues from a finished explore report, after a human has read
 * it (e2e/README.md, "Exploratory bug bash"). Opt-in and separate from the run:
 *
 *   npm run explore:file-issues -- exploratory/reports/<run> --dry-run
 *   npm run explore:file-issues -- exploratory/reports/<run> --min-severity high
 */

import { parseArgs } from "node:util";
import { fileIssues } from "../exploratory/lib/issues.mjs";
import { SEVERITIES } from "../exploratory/lib/findings.mjs";

const usage = "Usage: npm run explore:file-issues -- <report dir> [--dry-run] [--min-severity critical|high|medium|low] [--repo owner/name]";

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      "min-severity": { type: "string", default: "medium" },
      repo: { type: "string" },
    },
  });
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(2);
}
const [reportDir] = parsed.positionals;
const minSeverity = parsed.values["min-severity"];
if (!reportDir || parsed.positionals.length > 1 || !SEVERITIES.includes(minSeverity)) {
  console.error(usage);
  process.exit(2);
}

try {
  const result = fileIssues(reportDir, {
    dryRun: parsed.values["dry-run"],
    minSeverity,
    repo: parsed.values.repo,
  });
  console.log(`[file-issues] planned ${result.planned}, created ${result.created}, skipped ${result.skipped}`);
} catch (error) {
  console.error(`[file-issues] ${error.message}`);
  process.exit(1);
}
