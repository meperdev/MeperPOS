#!/usr/bin/env node
// Workflow entry point: classify one PR, then set its semáforo label and the
// single summary comment. It never fails the job: every problem becomes a
// `::warning::` and the process exits 0.
//
// Environment:
//   GITHUB_TOKEN            required
//   GITHUB_REPOSITORY       owner/repo (set by Actions)
//   GITHUB_EVENT_PATH       event payload, for the PR number (set by Actions)
//   SEMAFORO_PR             PR number; overrides the event payload (local runs)
//   SEMAFORO_DRY_RUN=1      read and print the plan, write nothing
//   GITHUB_API_URL          defaults to https://api.github.com
//   GITHUB_STEP_SUMMARY     optional; the result is appended there

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify, suggestTrust } from './classify.mjs';
import { buildComment, decideLabels, findBotComment } from './decide.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PER_PAGE = 100;
// GitHub returns at most 3000 files for a PR: 30 pages of 100.
const MAX_FILE_PAGES = 30;
const MAX_EVENT_PAGES = 10;
const MAX_COMMENT_PAGES = 10;

export async function loadConfig(file = path.join(HERE, 'config.json')) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function createApi({ token, apiUrl = 'https://api.github.com', fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  async function request(method, route, body) {
    const res = await fetchImpl(`${apiUrl}${route}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'semaforo-labeler',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = new Error(`${method} ${route} -> HTTP ${res.status} ${text.slice(0, 200)}`.trim());
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /** @returns {Promise<{ items: any[], complete: boolean }>} */
  async function paginate(route, maxPages) {
    const items = [];
    const sep = route.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const batch = await request('GET', `${route}${sep}per_page=${PER_PAGE}&page=${page}`);
      if (!Array.isArray(batch)) throw new Error(`GET ${route}: expected an array`);
      items.push(...batch);
      if (batch.length < PER_PAGE) return { items, complete: true };
    }
    return { items, complete: false };
  }

  return { request, paginate };
}

function escapeCommand(message) {
  return String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

async function prNumberFrom(env) {
  if (env.SEMAFORO_PR) return Number(env.SEMAFORO_PR);
  if (!env.GITHUB_EVENT_PATH) return NaN;
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  return Number(event.pull_request?.number ?? event.number);
}

/**
 * Never throws. Returns what it computed, what it wrote and every warning.
 */
export async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, config: givenConfig } = {}) {
  const warnings = [];
  const writes = [];
  const warn = (message) => {
    warnings.push(message);
    log(`::warning title=semaforo::${escapeCommand(message)}`);
  };
  const result = { warnings, writes, classification: null, decision: null, comment: null, dryRun: false, readOnly: false };

  try {
    const config = givenConfig ?? (await loadConfig());
    const token = env.GITHUB_TOKEN;
    const repo = env.GITHUB_REPOSITORY ?? '';
    const number = await prNumberFrom(env);
    if (!token) throw new Error('GITHUB_TOKEN is not set');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`GITHUB_REPOSITORY is not owner/repo: "${repo}"`);
    if (!Number.isInteger(number) || number <= 0) throw new Error('no pull request number (GITHUB_EVENT_PATH or SEMAFORO_PR)');

    const dryRun = env.SEMAFORO_DRY_RUN === '1' || env.SEMAFORO_DRY_RUN === 'true';
    result.dryRun = dryRun;
    const api = createApi({ token, apiUrl: env.GITHUB_API_URL || 'https://api.github.com', fetchImpl });
    const base = `/repos/${repo}`;

    const pr = await api.request('GET', `${base}/pulls/${number}`);
    const files = await api.paginate(`${base}/pulls/${number}/files`, MAX_FILE_PAGES);
    const classification = classify(
      { files: files.items, totals: { changedFiles: pr.changed_files, additions: pr.additions, deletions: pr.deletions } },
      config,
    );
    result.classification = classification;
    if (classification.stats.truncated) warn(`only ${classification.stats.fetchedFiles} of ${classification.stats.changedFiles} files could be read; verde is not possible`);
    const trust = suggestTrust(files.items, config);

    // A fork (or a deleted fork) runs with a read-only token on pull_request.
    const readOnly = !pr.head?.repo || pr.head.repo.full_name !== pr.base?.repo?.full_name;
    result.readOnly = readOnly;

    let events = null;
    try {
      const page = await api.paginate(`${base}/issues/${number}/events`, MAX_EVENT_PAGES);
      if (page.complete) events = page.items;
      else warn('label history too long to read completely; labels left unchanged');
    } catch (error) {
      warn(`could not read the label history, labels left unchanged: ${error.message}`);
    }

    const currentLabels = (pr.labels ?? []).map((l) => l.name);
    let decision = decideLabels({ currentLabels, events, computedColor: classification.color, config });
    let labelNote = null;
    for (const label of decision.add) {
      try {
        await api.request('GET', `${base}/labels/${encodeURIComponent(label)}`);
      } catch (error) {
        // Adding a label that does not exist would create it; never do that.
        const why = error.status === 404 ? 'does not exist in this repository' : `could not be checked (${error.message})`;
        warn(`label "${label}" ${why}; no label changed`);
        labelNote = `Label \`${label}\` ${why}, so no label was changed.`;
        decision = { ...decision, add: [], remove: [] };
        break;
      }
    }
    result.decision = decision;

    let existing = null;
    let commentsReadable = true;
    try {
      const comments = await api.paginate(`${base}/issues/${number}/comments`, MAX_COMMENT_PAGES);
      existing = findBotComment(comments.items, config);
      if (!existing && !comments.complete) commentsReadable = false;
    } catch (error) {
      commentsReadable = false;
      warn(`could not read the PR comments, comment left unchanged: ${error.message}`);
    }
    const body = buildComment({ classification, decision, trust, config, labelNote });
    let commentAction = 'none';
    if (commentsReadable) commentAction = existing ? (existing.body === body ? 'unchanged' : 'update') : 'create';
    result.comment = { action: commentAction, body };

    const plan = [
      ...decision.add.map((label) => ({ kind: 'add-label', label })),
      ...decision.remove.map((label) => ({ kind: 'remove-label', label })),
      ...(commentAction === 'create' || commentAction === 'update' ? [{ kind: `${commentAction}-comment` }] : []),
    ];

    log(`semaforo: PR #${number} -> ${classification.color ?? 'none'} (mode ${decision.mode}, ${classification.stats.changedFiles} files, ${classification.stats.countedLines} lines)`);
    for (const r of classification.reasons) log(`  - [${r.color ?? '-'}] ${r.reason}${r.files.length ? ` (${r.files.slice(0, 3).join(', ')}${r.files.length > 3 ? ', ...' : ''})` : ''}`);
    log(`semaforo: planned writes: ${plan.length ? plan.map((p) => p.label ? `${p.kind} ${p.label}` : p.kind).join(', ') : 'none'}`);

    if (readOnly && plan.length > 0) {
      warn('fork pull request: the token is read-only, so no label or comment was written');
    } else if (dryRun) {
      log('semaforo: dry run, nothing written. Comment body:');
      log(body);
    } else {
      const attempt = async (step, fn) => {
        try {
          await fn();
          writes.push(step);
        } catch (error) {
          if (step.kind === 'remove-label' && error.status === 404) return; // already gone
          warn(`${step.kind}${step.label ? ` ${step.label}` : ''} failed: ${error.message}`);
        }
      };
      // Add before remove: a cancelled run leaves two bot labels, which the
      // next run reduces to one, never a PR that silently lost its color.
      for (const step of plan) {
        if (step.kind === 'add-label') {
          await attempt(step, () => api.request('POST', `${base}/issues/${number}/labels`, { labels: [step.label] }));
        } else if (step.kind === 'remove-label') {
          await attempt(step, () => api.request('DELETE', `${base}/issues/${number}/labels/${encodeURIComponent(step.label)}`));
        } else if (step.kind === 'update-comment') {
          await attempt(step, () => api.request('PATCH', `${base}/issues/comments/${existing.id}`, { body }));
        } else if (step.kind === 'create-comment') {
          await attempt(step, () => api.request('POST', `${base}/issues/${number}/comments`, { body }));
        }
      }
    }

    if (env.GITHUB_STEP_SUMMARY) {
      await appendFile(env.GITHUB_STEP_SUMMARY, `${body.replace(config.commentMarker, '').trim()}\n`).catch(() => {});
    }
  } catch (error) {
    warn(`semaforo skipped, nothing was changed: ${error.message}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
  process.exitCode = 0;
}
