/**
 * Tests for scripts/bug-log.mjs (bug -> rule log printer and lenient checker).
 *
 * Runs with `node scripts/bug-log.test.mjs` and inside backend
 * `npm run test:eslint-plugin`, the existing CI step. It only checks the shape
 * of entry files that exist; it never requires a PR to add one.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DIR,
  parseFrontmatter,
  readEntries,
  renderTable,
} from './bug-log.mjs';

const SCRIPT = fileURLToPath(new URL('./bug-log.mjs', import.meta.url));

const VALID = `---
date: 2026-11-21
layer: "01+02"
title: CSRF cookie expired before the refresh token
source: "CSRF cookie lifetime ([#392](https://github.com/meperdev/MeperPOS/pull/392))"
pr: 392
paths:
  - "backend/src/auth/cookies.helper.ts (\`REFRESH_TTL_MS\`)"
tests: [backend/src/auth/cookies.helper.spec.ts, e2e/tests/session-restart.spec.ts]
reviewer: someone # unknown fields are allowed
---

Full description | with a pipe.
`;

const MINIMAL = `---
date: 2026-11-20
layer: 02
pr:
---
Only the required fields; pr is still unknown.
`;

const scratch = [];
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bug-log-test-'));
  scratch.push(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('parseFrontmatter', () => {
  test('reads scalars, quoted strings, both list styles and the body', () => {
    const { data, body } = parseFrontmatter(VALID);
    assert.equal(data.date, '2026-11-21');
    assert.equal(data.layer, '01+02');
    assert.equal(data.pr, '392');
    assert.equal(
      data.source,
      'CSRF cookie lifetime ([#392](https://github.com/meperdev/MeperPOS/pull/392))',
    );
    assert.deepEqual(data.paths, [
      'backend/src/auth/cookies.helper.ts (`REFRESH_TTL_MS`)',
    ]);
    assert.deepEqual(data.tests, [
      'backend/src/auth/cookies.helper.spec.ts',
      'e2e/tests/session-restart.spec.ts',
    ]);
    assert.equal(data.reviewer, 'someone');
    assert.equal(body, 'Full description | with a pipe.');
  });

  test('keeps an unquoted layer as text and an empty pr as null', () => {
    const { data } = parseFrontmatter(MINIMAL);
    assert.equal(data.layer, '02');
    assert.equal(data.pr, null);
  });

  test('a quoted value may be followed by a comment that contains quotes', () => {
    const { data } = parseFrontmatter(
      `---\nlayer: "02" # or a mix like "01+02"\ntitle: 'it''s' # 'x'\n---\n`,
    );
    assert.equal(data.layer, '02');
    assert.equal(data.title, "it's");
  });

  test('accepts CRLF line endings', () => {
    const { data } = parseFrontmatter(MINIMAL.replace(/\n/g, '\r\n'));
    assert.equal(data.date, '2026-11-20');
  });
});

describe('readEntries', () => {
  test('a valid entry and a minimal entry pass; template and other files are ignored', () => {
    const dir = folder({
      '2026-11-21-pr-392-csrf-cookie-ttl.md': VALID,
      '2026-11-20-minimal-entry.md': MINIMAL,
      '_TEMPLATE.md': '---\ndate: YYYY-MM-DD\n---\nnot an entry\n',
      '.gitkeep': '',
      'notes.txt': 'not markdown',
    });
    const { entries, errors } = readEntries(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      entries.map((entry) => entry.file),
      ['2026-11-20-minimal-entry.md', '2026-11-21-pr-392-csrf-cookie-ttl.md'],
    );
  });

  test('a missing date names the file and says what to add', () => {
    const dir = folder({
      '2026-11-21-no-date.md': '---\nlayer: "02"\n---\nbody\n',
    });
    const { entries, errors } = readEntries(dir);
    assert.equal(entries.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /2026-11-21-no-date\.md: add `date: YYYY-MM-DD`/);
  });

  test('a missing layer and a malformed date are reported', () => {
    const dir = folder({
      '2026-11-21-no-layer.md': '---\ndate: 21/11/2026\n---\nbody\n',
    });
    const { errors } = readEntries(dir);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /`date` must be YYYY-MM-DD, got "21\/11\/2026"/);
    assert.match(errors[1], /add `layer: "02"`/);
  });

  test('a file name off the convention is reported with an example', () => {
    const dir = folder({ 'CSRF Fix.md': MINIMAL });
    const { errors } = readEntries(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /CSRF Fix\.md: rename it to `YYYY-MM-DD-<slug>\.md`/);
  });

  test('a file without frontmatter is reported', () => {
    const dir = folder({ '2026-11-21-no-frontmatter.md': '# Just a heading\n' });
    const { errors } = readEntries(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must start with a `---` frontmatter block/);
  });

  test('optional YAML does not gate entries or corrupt printed paths', () => {
    for (const [fields, expected] of [
      ['paths:\n  # regression lives here\n  - src/fix.ts', ['src/fix.ts']],
      [
        'paths: ["src/fix.ts (guard, regression)", test/fix.ts]',
        ['src/fix.ts (guard, regression)', 'test/fix.ts'],
      ],
      ['paths: ["src/fix.ts (issue #601)"]', ['src/fix.ts (issue #601)']],
      ['review:\n  owner: maintainer', undefined],
      ['notes: |\n  first line\n  second line\npaths: [a.ts]', ['a.ts']],
    ]) {
      const dir = folder({
        '2026-11-23-probe.md': `---\ndate: 2026-11-23\nlayer: 02\n${fields}\n---\n`,
      });
      const result = run('--check', dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'Bug -> rule log: 1 entries OK\n');
      const { entries } = readEntries(dir);
      assert.deepEqual(entries[0].data.paths, expected);
      if (fields.includes('#601')) {
        assert.ok(renderTable(entries).includes('`src/fix.ts` (issue #601)'));
      }
    }
  });

  test('an unreadable optional field is a warning, an unreadable date is an error', () => {
    const dir = folder({
      '2026-11-23-odd-title.md':
        '---\ndate: 2026-11-23\nlayer: "02"\ntitle: "unterminated\n---\n',
      '2026-11-23-odd-date.md': '---\ndate: "2026-11-23\nlayer: "02"\n---\n',
    });
    const { entries, errors, warnings } = readEntries(dir);
    assert.deepEqual(entries.map((entry) => entry.file), ['2026-11-23-odd-title.md']);
    assert.equal(entries[0].data.title, '"unterminated');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /odd-title\.md: frontmatter line 4 kept as plain text/);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /odd-date\.md: fix `date` \(frontmatter line 2\)/);
  });

  const TEMPLATE = join(DEFAULT_DIR, '_TEMPLATE.md');
  test('a copy of _TEMPLATE.md with only the date filled in is a valid entry', {
    skip: !existsSync(TEMPLATE) && 'no template in docs/bug-rules',
  }, () => {
    const template = readFileSync(TEMPLATE, 'utf8');
    const dir = folder({
      '2026-11-23-copied-template.md': template.replace('date: YYYY-MM-DD', 'date: 2026-11-23'),
    });
    const { errors, warnings } = readEntries(dir);
    assert.deepEqual([...errors, ...warnings], []);
  });

  test('an empty folder is fine: no entry is ever required', () => {
    assert.deepEqual(readEntries(folder({})), {
      entries: [],
      errors: [],
      warnings: [],
    });
  });
});

describe('renderTable', () => {
  test('one row per entry, sorted by date then file name, pipes escaped', () => {
    const dir = folder({
      '2026-11-21-b.md': VALID,
      '2026-11-21-a.md': VALID.replace('pr: 392', 'pr:'),
      '2026-11-20-minimal-entry.md': MINIMAL,
    });
    const lines = renderTable(readEntries(dir).entries).split('\n');
    assert.equal(lines.length, 2 + 3);
    assert.match(lines[2], /^\| 2026-11-20 \| \[2026-11-20-minimal-entry\]/);
    assert.match(lines[3], /docs\/bug-rules\/2026-11-21-a\.md\).* \|  \|$/);
    assert.match(lines[4], /docs\/bug-rules\/2026-11-21-b\.md/);
    assert.match(
      lines[4],
      /`backend\/src\/auth\/cookies\.helper\.ts` \(`REFRESH_TTL_MS`\) · tests `backend\/src\/auth\/cookies\.helper\.spec\.ts`, `e2e\/tests\/session-restart\.spec\.ts`/,
    );
    assert.match(lines[4], /\[#392\]\(https:\/\/github\.com\/meperdev\/MeperPOS\/pull\/392\) \|$/);
  });
});

describe('CLI', () => {
  test('prints the table and exits 0', () => {
    const dir = folder({ '2026-11-21-pr-392-csrf-cookie-ttl.md': VALID });
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 3);
  });

  test('exits 1 with the file and the fix on stderr', () => {
    const dir = folder({ '2026-11-21-broken.md': '---\nlayer: "02"\n---\n' });
    const result = run('--check', dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /2026-11-21-broken\.md: add `date: YYYY-MM-DD`/);
  });
});

describe('docs/bug-rules', () => {
  test('every entry file in the repository is well formed', () => {
    const { errors } = readEntries(DEFAULT_DIR);
    assert.deepEqual(errors, [], errors.join('\n'));
  });
});
