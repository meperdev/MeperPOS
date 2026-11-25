import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { run } from './run.mjs';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const BOT = config.botLogin;
const REPO = 'meperdev/MeperPOS';

/** In-memory GitHub: just the endpoints run.mjs uses. Records every write. */
function fakeGitHub({ files = [], labels = [], events = [], comments = [], repoLabels = ['semaforo:verde', 'semaforo:amarillo', 'semaforo:rojo', 'semaforo:manual'], fork = false, fail = {} } = {}) {
  const state = { labels: [...labels], events: [...events], comments: comments.map((c) => ({ ...c })), writes: [] };
  const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, { method, body }) => {
    const u = new URL(url);
    const route = u.pathname.replace(`/repos/${REPO}`, '');
    const page = Number(u.searchParams.get('page') ?? 1);
    const key = `${method} ${route.replace(/\d+/g, ':n')}`;
    if (fail[key]) return json(fail[key], { message: 'boom' });
    const pageOf = (items) => json(200, items.slice((page - 1) * 100, page * 100));
    if (method === 'GET' && route === '/pulls/7') {
      return json(200, {
        number: 7,
        changed_files: files.length,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: 0,
        labels: state.labels.map((name) => ({ name })),
        head: { repo: { full_name: fork ? 'someone/MeperPOS' : REPO } },
        base: { repo: { full_name: REPO } },
      });
    }
    if (method === 'GET' && route === '/pulls/7/files') return pageOf(files);
    if (method === 'GET' && route === '/issues/7/events') return pageOf(state.events);
    if (method === 'GET' && route === '/issues/7/comments') return pageOf(state.comments);
    if (method === 'GET' && route.startsWith('/labels/')) {
      return repoLabels.includes(decodeURIComponent(route.slice('/labels/'.length))) ? json(200, {}) : json(404, { message: 'Not Found' });
    }
    state.writes.push({ method, route, body: body ? JSON.parse(body) : undefined });
    if (method === 'POST' && route === '/issues/7/labels') {
      const { labels: added } = JSON.parse(body);
      for (const name of added) {
        if (!state.labels.includes(name)) state.labels.push(name);
        state.events.push({ id: state.events.length + 1, event: 'labeled', label: { name }, actor: { login: BOT }, created_at: `2026-11-22T01:00:${String(state.events.length).padStart(2, '0')}Z` });
      }
      return json(200, []);
    }
    if (method === 'DELETE' && route.startsWith('/issues/7/labels/')) {
      const name = decodeURIComponent(route.slice('/issues/7/labels/'.length));
      state.labels = state.labels.filter((l) => l !== name);
      state.events.push({ id: state.events.length + 1, event: 'unlabeled', label: { name }, actor: { login: BOT }, created_at: `2026-11-22T01:00:${String(state.events.length).padStart(2, '0')}Z` });
      return json(200, []);
    }
    if (method === 'POST' && route === '/issues/7/comments') {
      state.comments.push({ id: 99, user: { login: BOT }, body: JSON.parse(body).body });
      return json(201, {});
    }
    if (method === 'PATCH' && route === '/issues/comments/99') {
      state.comments.find((c) => c.id === 99).body = JSON.parse(body).body;
      return json(200, {});
    }
    return json(404, { message: `unhandled ${method} ${route}` });
  };
  return { state, fetchImpl };
}

const env = (extra = {}) => ({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: REPO, SEMAFORO_PR: '7', ...extra });
const quiet = () => {};
const f = (filename, additions = 5) => ({ filename, status: 'modified', additions, deletions: 0 });
const go = (gh, extraEnv) => run({ env: env(extraEnv), fetchImpl: gh.fetchImpl, log: quiet, config });

describe('run', () => {
  it('first run labels the PR and creates one comment; a re-run writes nothing', async () => {
    const gh = fakeGitHub({ files: [f('backend/src/auth/a.ts')] });
    const first = await go(gh);
    assert.deepEqual(first.warnings, []);
    assert.deepEqual(gh.state.labels, ['semaforo:rojo']);
    assert.equal(gh.state.comments.length, 1);
    const writesAfterFirst = gh.state.writes.length;

    const second = await go(gh);
    assert.equal(gh.state.writes.length, writesAfterFirst, 'no writes on an unchanged PR');
    assert.equal(second.comment.action, 'unchanged');
  });

  it('a new push with a different color replaces the bot label and edits the same comment', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')] });
    await go(gh);
    assert.deepEqual(gh.state.labels, ['semaforo:verde']);

    gh.state.writes.length = 0;
    const next = fakeGitHub({ files: [f('docs/a.md'), f('backend/src/payroll/x.ts')], labels: gh.state.labels, events: gh.state.events, comments: gh.state.comments });
    await go(next);
    assert.deepEqual(next.state.labels, ['semaforo:rojo']);
    assert.equal(next.state.comments.length, 1);
    assert.deepEqual(next.state.writes.map((w) => w.method), ['POST', 'DELETE', 'PATCH'], 'add before remove, then edit');
  });

  it('semaforo:manual: no label writes', async () => {
    const gh = fakeGitHub({ files: [f('backend/src/auth/a.ts')], labels: ['semaforo:manual'], events: [{ id: 1, event: 'labeled', label: { name: 'semaforo:manual' }, actor: { login: 'meperdev' }, created_at: '2026-01-01T00:00:00Z' }] });
    const result = await go(gh);
    assert.equal(result.decision.mode, 'manual');
    assert.deepEqual(gh.state.labels, ['semaforo:manual']);
    assert.ok(gh.state.writes.every((w) => !w.route.includes('/labels')));
  });

  it('a hand-set label is kept', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')], labels: ['semaforo:rojo'], events: [{ id: 1, event: 'labeled', label: { name: 'semaforo:rojo' }, actor: { login: 'meperdev' }, created_at: '2026-01-01T00:00:00Z' }] });
    await go(gh);
    assert.deepEqual(gh.state.labels, ['semaforo:rojo']);
  });

  it('a missing repo label: no label change, a warning, still exits normally', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')], repoLabels: [] });
    const result = await go(gh);
    assert.deepEqual(gh.state.labels, []);
    assert.ok(result.warnings.some((w) => w.includes('does not exist')));
    assert.ok(gh.state.writes.every((w) => !w.route.includes('/labels')));
  });

  it('a fork PR: computes the color, writes nothing, warns', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')], fork: true });
    const result = await go(gh);
    assert.equal(result.classification.color, 'verde');
    assert.equal(gh.state.writes.length, 0);
    assert.ok(result.warnings.some((w) => w.includes('read-only')));
  });

  it('dry run writes nothing', async () => {
    const gh = fakeGitHub({ files: [f('backend/src/auth/a.ts')] });
    const result = await go(gh, { SEMAFORO_DRY_RUN: '1' });
    assert.equal(gh.state.writes.length, 0);
    assert.equal(result.comment.action, 'create');
    assert.deepEqual(result.decision.add, ['semaforo:rojo']);
  });

  it('an API error before any write: warning, nothing changed, no throw', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')], fail: { 'GET /pulls/:n': 502 } });
    const result = await go(gh);
    assert.equal(gh.state.writes.length, 0);
    assert.match(result.warnings[0], /nothing was changed/);
  });

  it('unreadable label history: no label writes', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')], fail: { 'GET /issues/:n/events': 500 } });
    const result = await go(gh);
    assert.equal(result.decision.mode, 'unknown');
    assert.ok(gh.state.writes.every((w) => !w.route.includes('/labels')));
  });

  it('a failing write (403) is a warning, not a crash', async () => {
    const gh = fakeGitHub({ files: [f('docs/a.md')], fail: { 'POST /issues/:n/labels': 403 } });
    const result = await go(gh);
    assert.ok(result.warnings.some((w) => w.includes('add-label semaforo:verde failed')));
    assert.equal(gh.state.comments.length, 1, 'the comment is still written');
  });

  it('missing token or PR number: warning, no throw', async () => {
    const r1 = await run({ env: { GITHUB_REPOSITORY: REPO, SEMAFORO_PR: '7' }, fetchImpl: () => assert.fail('no fetch'), log: quiet, config });
    assert.match(r1.warnings[0], /GITHUB_TOKEN/);
    const r2 = await run({ env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: REPO }, fetchImpl: () => assert.fail('no fetch'), log: quiet, config });
    assert.match(r2.warnings[0], /pull request number/);
  });

  it('paginates the file list past 100 files', async () => {
    const files = Array.from({ length: 150 }, (_, i) => f(`docs/n${i}.md`, 1));
    const gh = fakeGitHub({ files });
    const result = await go(gh, { SEMAFORO_DRY_RUN: '1' });
    assert.equal(result.classification.stats.fetchedFiles, 150);
    assert.equal(result.classification.stats.truncated, false);
  });
});
