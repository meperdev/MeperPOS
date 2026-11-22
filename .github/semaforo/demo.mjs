#!/usr/bin/env node
// Read-only calibration: classify real PRs and compare with their labels.
//   GITHUB_TOKEN=$(gh auth token) node .github/semaforo/demo.mjs 385 386 387
// Only GET requests; never writes to GitHub.

import { classify } from './classify.mjs';
import { createApi, loadConfig } from './run.mjs';

const repo = process.env.GITHUB_REPOSITORY || 'meperdev/MeperPOS';
const numbers = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!process.env.GITHUB_TOKEN || numbers.length === 0) {
  console.error('usage: GITHUB_TOKEN=... node .github/semaforo/demo.mjs <pr> [pr...]');
  process.exit(2);
}

const config = await loadConfig();
const api = createApi({ token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com' });
const rows = [];
for (const n of numbers) {
  const pr = await api.request('GET', `/repos/${repo}/pulls/${n}`);
  const files = await api.paginate(`/repos/${repo}/pulls/${n}/files`, 30);
  const result = classify({ files: files.items, totals: { changedFiles: pr.changed_files, additions: pr.additions, deletions: pr.deletions } }, config);
  const actual = (pr.labels ?? []).map((l) => l.name).filter((l) => l.startsWith(config.labelPrefix)).map((l) => l.slice(config.labelPrefix.length));
  rows.push({
    pr: `#${n}`,
    computed: result.color ?? 'none',
    actual: actual.join(',') || '(none)',
    match: actual.length === 0 ? '-' : actual.includes(result.color) ? 'yes' : 'NO',
    reasons: result.reasons.map((r) => r.id).join(', '),
  });
}

const cols = ['pr', 'computed', 'actual', 'match', 'reasons'];
console.log(`| ${cols.join(' | ')} |`);
console.log(`|${cols.map(() => '---').join('|')}|`);
for (const row of rows) console.log(`| ${cols.map((c) => row[c]).join(' | ')} |`);
