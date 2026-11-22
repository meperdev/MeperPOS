/**
 * Opt-in issue filing for a finished report (`--file-issues`). Off by default:
 * nothing here runs unless a human asks for it, and `--dry-run` prints the
 * `gh` commands without creating anything.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { issueDraft } from "./report.mjs";
import { atLeast } from "./findings.mjs";

/**
 * The `gh issue create` argument lists for the findings of a report.
 * @param {Array<Record<string, any>>} findings  as stored in findings.json
 * @param {{ minSeverity?: string, reportPath?: string, repo?: string }} [options]
 */
export function issueCommands(findings, options = {}) {
  const minSeverity = options.minSeverity ?? "low";
  return findings
    .filter((finding) => finding.severity !== "info" && atLeast(finding.severity, minSeverity))
    .map((finding) => {
      const { title, body } = issueDraft(finding, { reportPath: options.reportPath });
      const args = ["issue", "create", "--title", title, "--body", body];
      if (options.repo) args.push("--repo", options.repo);
      return { id: finding.id, title, args };
    });
}

/** Reads `<reportDir>/findings.json`, written by the explorer. */
export function readReportFindings(reportDir) {
  const raw = readFileSync(join(reportDir, "findings.json"), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.findings)) {
    throw new Error(`${reportDir}/findings.json has no "findings" array`);
  }
  return parsed.findings;
}

/**
 * Files one issue per finding at or above `minSeverity`, skipping titles that
 * already have an open issue. With `dryRun`, only prints.
 */
export function fileIssues(reportDir, options = {}) {
  const { dryRun = false, log = console.log } = options;
  const commands = issueCommands(readReportFindings(reportDir), {
    ...options,
    reportPath: join(reportDir, "REPORT.md"),
  });
  if (commands.length === 0) {
    log("[file-issues] no findings above info; nothing to file");
    return { created: 0, skipped: 0, planned: 0 };
  }
  let created = 0;
  let skipped = 0;
  for (const command of commands) {
    if (dryRun) {
      log(`[file-issues] (dry run) would run: gh issue create --title ${JSON.stringify(command.title)} --body <${command.args[5].length} chars>`);
      continue;
    }
    const existing = spawnSync(
      "gh",
      ["issue", "list", "--state", "open", "--search", `"${command.title}" in:title`, "--json", "number", "--jq", "length",
        ...(options.repo ? ["--repo", options.repo] : [])],
      { encoding: "utf8" },
    );
    if (existing.status === 0 && Number(existing.stdout.trim()) > 0) {
      log(`[file-issues] skipped ${command.id}: an open issue already has this title`);
      skipped += 1;
      continue;
    }
    const result = spawnSync("gh", command.args, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`gh issue create failed for ${command.id} (exit ${result.status})`);
    }
    created += 1;
  }
  return { created, skipped, planned: commands.length };
}
