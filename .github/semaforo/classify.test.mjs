import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { classify, compileConfig, globToRegExp, maxColor, suggestTrust } from './classify.mjs';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));

const file = (filename, additions = 5, deletions = 0, extra = {}) => ({ filename, status: 'modified', additions, deletions, ...extra });
const run = (files, totals = {}) => classify({ files, totals }, config);
const ids = (result) => result.reasons.map((r) => r.id);

describe('globToRegExp', () => {
  it('keeps * inside one path segment', () => {
    assert.ok(globToRegExp('docs/*.md').test('docs/a.md'));
    assert.ok(!globToRegExp('docs/*.md').test('docs/x/a.md'));
  });
  it('lets **/ match zero or more directories', () => {
    const re = globToRegExp('**/*.md');
    assert.ok(re.test('README.md'));
    assert.ok(re.test('a/b/c.md'));
    assert.ok(!re.test('a/b/c.mdx'));
  });
  it('lets dir/** match anything below dir, but not a sibling with the same prefix', () => {
    const re = globToRegExp('backend/src/auth/**');
    assert.ok(re.test('backend/src/auth/x.ts'));
    assert.ok(re.test('backend/src/auth/dto/y.ts'));
    assert.ok(!re.test('backend/src/authz/x.ts'));
  });
  it('expands {a,b} and escapes regex characters such as ( ) and .', () => {
    const re = globToRegExp('frontend/src/app/settings/{(billing),(invoicing)}/**');
    assert.ok(re.test('frontend/src/app/settings/(billing)/billing/page.tsx'));
    assert.ok(!re.test('frontend/src/app/settings/billing/page.tsx'));
    assert.ok(!globToRegExp('a.ts').test('abts'));
  });
  it('rejects an empty glob', () => {
    assert.throws(() => globToRegExp(''));
  });
});

describe('maxColor', () => {
  it('ranks rojo > amarillo > verde and treats null as no color', () => {
    assert.equal(maxColor('verde', 'rojo'), 'rojo');
    assert.equal(maxColor('rojo', 'amarillo'), 'rojo');
    assert.equal(maxColor(null, 'verde'), 'verde');
    assert.equal(maxColor('amarillo', null), 'amarillo');
  });
});

describe('config.json', () => {
  it('compiles', () => {
    assert.doesNotThrow(() => compileConfig(config));
  });
  it('rejects a rule with an unknown color', () => {
    assert.throws(() => compileConfig({ ...config, rules: [{ id: 'x', color: 'azul', reason: 'r', paths: ['a'] }] }), /color/);
  });
});

describe('classify: colors', () => {
  it('a small docs-only PR is verde', () => {
    const result = run([file('docs/referencias/alertas.md', 20, 3), file('README.md')]);
    assert.equal(result.color, 'verde');
    assert.deepEqual(ids(result), ['docs']);
  });

  it('a small tests-only PR is verde', () => {
    const result = run([file('frontend/src/components/ui/Button.test.tsx', 40), file('e2e/tests/login.spec.ts', 10)]);
    assert.equal(result.color, 'verde');
    assert.deepEqual(ids(result), ['tests']);
  });

  it('ordinary source outside every domain is amarillo', () => {
    const result = run([file('frontend/src/components/ui/Button.tsx'), file('frontend/src/components/ui/Button.test.tsx')]);
    assert.equal(result.color, 'amarillo');
    assert.deepEqual(ids(result), ['code']);
  });

  it('dependency changes are amarillo, never verde', () => {
    assert.equal(run([file('backend/package.json', 1, 1)]).color, 'amarillo');
    assert.deepEqual(ids(run([file('e2e/package-lock.json', 1, 1)])), ['dependencies']);
  });

  it('AGENTS.md is agent instructions (amarillo), not plain docs', () => {
    const result = run([file('AGENTS.md', 2)]);
    assert.equal(result.color, 'amarillo');
    assert.deepEqual(ids(result), ['agent-instructions']);
  });

  for (const [path, rule] of [
    ['.github/workflows/ci.yml', 'ci'],
    ['.github/semaforo/config.json', 'ci'],
    ['backend/prisma/schema.prisma', 'schema'],
    ['backend/prisma/migrations/20260101000000_x/migration.sql', 'schema'],
    ['backend/eslint-plugin-meperpos/rules/require-string-length-bound.mjs', 'lint'],
    ['frontend/eslint.config.mjs', 'lint'],
    ['backend/eslint.baseline.mjs', 'lint'],
    ['backend/src/main.ts', 'architecture'],
    ['backend/src/auth/cookies.helper.ts', 'auth'],
    ['backend/src/common/guards/organization-required.guard.ts', 'auth'],
    ['frontend/src/lib/session.ts', 'auth'],
    ['backend/src/sales/sales.service.ts', 'payments'],
    ['frontend/src/app/settings/(billing)/billing/page.tsx', 'payments'],
    ['frontend/src/hooks/useLoans.ts', 'payments'],
    ['backend/src/products/dto/product.dto.ts', 'inventory'],
    ['backend/src/alerts/stock-alerts.logic.ts', 'inventory'],
    ['frontend/src/app/inventory/page.tsx', 'inventory'],
    ['backend/src/payroll/payroll-allocation.ts', 'payroll'],
    ['frontend/src/app/employees/page.tsx', 'payroll'],
  ]) {
    it(`${path} is rojo (${rule})`, () => {
      const result = run([file(path)]);
      assert.equal(result.color, 'rojo');
      assert.deepEqual(ids(result), [rule]);
    });
  }

  it('a test inside a rojo domain is still rojo (weakening an auth test is an auth change)', () => {
    assert.equal(run([file('backend/src/auth/auth.service.spec.ts')]).color, 'rojo');
  });

  it('Prisma seeds are not schema: amarillo', () => {
    assert.equal(run([file('backend/prisma/seed-e2e.ts')]).color, 'amarillo');
  });
});

describe('classify: highest color wins', () => {
  it('docs + code + auth is rojo and only lists the rojo reason', () => {
    const result = run([file('docs/a.md'), file('frontend/src/components/ui/Button.tsx'), file('backend/src/auth/auth.service.ts')]);
    assert.equal(result.color, 'rojo');
    assert.deepEqual(ids(result), ['auth']);
    assert.deepEqual(result.reasons[0].files, ['backend/src/auth/auth.service.ts']);
  });

  it('lists every rojo domain touched, in config order', () => {
    const result = run([file('backend/src/payroll/x.ts'), file('.github/workflows/ci.yml'), file('backend/src/auth/y.ts')]);
    assert.deepEqual(ids(result), ['ci', 'auth', 'payroll']);
  });
});

describe('classify: renames and deletions', () => {
  it('a rename out of a rojo path is rojo (old path counts)', () => {
    const result = run([file('frontend/src/components/ui/Cookies.ts', 0, 0, { status: 'renamed', previous_filename: 'backend/src/auth/cookies.helper.ts' })]);
    assert.equal(result.color, 'rojo');
    assert.deepEqual(result.reasons[0].files, ['backend/src/auth/cookies.helper.ts']);
  });

  it('a rename into a rojo path is rojo (new path counts)', () => {
    const result = run([file('backend/src/payroll/helper.ts', 0, 0, { status: 'renamed', previous_filename: 'docs/helper.md' })]);
    assert.equal(result.color, 'rojo');
    assert.deepEqual(result.reasons[0].files, ['backend/src/payroll/helper.ts']);
  });

  it('deleting a rojo file is rojo', () => {
    const result = run([file('backend/src/common/guards/roles.guard.ts', 0, 120, { status: 'removed' })]);
    assert.equal(result.color, 'rojo');
  });
});

describe('classify: size and truncation', () => {
  it('a large docs/tests PR is amarillo, never verde', () => {
    const result = run([file('docs/a.md', 300), file('e2e/tests/x.spec.ts', 200)]);
    assert.equal(result.color, 'amarillo');
    assert.deepEqual(ids(result), ['size-lines']);
  });

  it('too many small files is amarillo', () => {
    const files = Array.from({ length: 31 }, (_, i) => file(`docs/n${i}.md`, 1));
    assert.deepEqual(ids(run(files)), ['size-files']);
  });

  it('lockfile lines do not count toward size', () => {
    const result = classify(
      { files: [file('docs/a.md', 10), file('e2e/package-lock.json', 5000)] },
      { ...config, rules: config.rules.filter((r) => r.id !== 'dependencies') },
    );
    assert.equal(result.stats.countedLines, 10);
  });

  it('exactly at the thresholds stays verde', () => {
    const files = Array.from({ length: 30 }, (_, i) => file(`docs/n${i}.md`, i === 0 ? 371 : 1));
    const result = run(files);
    assert.equal(result.stats.countedLines, 400);
    assert.equal(result.color, 'verde');
  });

  it('size never escalates past amarillo, and never downgrades rojo', () => {
    assert.equal(run([file('docs/a.md', 5000)]).color, 'amarillo');
    assert.equal(run([file('backend/src/auth/a.ts', 5000)]).color, 'rojo');
  });

  it('a truncated file list is never verde', () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`docs/n${i}.md`, 1));
    const result = run(files, { changedFiles: 3500, additions: 9000, deletions: 0 });
    assert.equal(result.stats.truncated, true);
    assert.equal(result.color, 'amarillo');
    assert.ok(ids(result).includes('truncated'));
  });

  it('a truncated list keeps a rojo color and says it was truncated', () => {
    const result = run([file('backend/src/auth/a.ts')], { changedFiles: 4000 });
    assert.equal(result.color, 'rojo');
    assert.deepEqual(ids(result), ['auth', 'truncated']);
  });

  it('reproduces #388/#389 as amarillo once CI files are set aside (e2e-only, >400 lines)', () => {
    const result = run([
      file('e2e/scripts/run-smoke.mjs', 304),
      file('e2e/tests/login.spec.ts', 32),
      file('e2e/README.md', 147),
      file('e2e/package-lock.json', 93),
      file('e2e/playwright.config.ts', 64),
    ]);
    assert.equal(result.color, 'amarillo');
  });
});

describe('classify: empty and malformed input', () => {
  it('an empty diff has no color and does not throw', () => {
    assert.equal(run([]).color, null);
    assert.equal(classify({}, config).color, null);
    assert.equal(classify(undefined, config).color, null);
  });

  it('ignores entries without a filename', () => {
    assert.equal(run([null, {}, { filename: '' }, file('docs/a.md')]).color, 'verde');
  });

  it('an empty list with changed_files > 0 is truncated, not empty', () => {
    assert.equal(run([], { changedFiles: 10 }).color, 'amarillo');
  });
});

describe('suggestTrust', () => {
  it('prefers the lint layer when a lint rule is touched', () => {
    const s = suggestTrust([file('backend/src/x/dto/a.dto.ts'), file('backend/eslint-plugin-meperpos/rules/r.mjs')], config);
    assert.equal(s.label, 'trust:02-lint-test');
  });
  it('suggests the codebase layer for a DTO change', () => {
    assert.equal(suggestTrust([file('backend/src/settings/dto/settings.dto.ts'), file('backend/src/settings/dto/settings.dto.spec.ts')], config).label, 'trust:01-codebase');
  });
  it('suggests nothing for plain code', () => {
    assert.equal(suggestTrust([file('frontend/src/components/ui/Button.tsx')], config), null);
  });
});
