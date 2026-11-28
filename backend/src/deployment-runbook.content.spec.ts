import * as fs from 'fs';
import * as path from 'path';

/**
 * Content contract for docs/runbooks/runbook-despliegue-produccion.md
 * (issue #116 / AUDIT-FINDING-010).
 *
 * Mirrors the style of backend/src/runbook.content.spec.ts: the markdown is read
 * from disk and asserted directly, with no Nest bootstrap and no database.
 *
 * Pinned criteria:
 *  - #1 the single versioned migration owner (backend/package.json, migrate:prod,
 *       start:prod) is named in the runbook;
 *  - #2 production provisioning goes through `provision:prod` plus
 *       POST /api/admin/organizations, and never through the development seed;
 *  - #3 the runbook does not claim that the build phase applies migrations;
 *  - #4 the operator has an explicit way to verify that migrations ran before
 *       the application started.
 *
 * The assertions look for roles and commands, never for one exact sentence, so
 * rewording the prose keeps the contract green while the real behavior is pinned.
 */

const RUNBOOK_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'runbooks',
  'runbook-despliegue-produccion.md',
);

/** Tokens that name the build phase of a deployment. */
const BUILD_PHASE_TOKEN =
  /\b(?:prebuild|pre-build|build|compile|compilar|compilacion)\b/i;

/** Any migration-related word: migrate, migration, migracion, migraciones. */
const MIGRATION_TOKEN = /\bmigra\w*/i;

/**
 * An instruction to run the development/demo seed. The suffixed scripts
 * (`seed:test-orgs:prod`, the explicitly opted-in test-organization seed) stay
 * allowed: only the bare `npm run seed` aliases the local development seed.
 */
const DEVELOPMENT_SEED_INSTRUCTION = /\bnpm run seed\b(?!:)/;

/**
 * A "claim unit" is a line, further split on sentence boundaries, so the
 * build-versus-migration assertions cannot be satisfied by shuffling words
 * inside one sentence.
 */
function claimUnits(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

describe('deployment runbook content (issue #116)', () => {
  let raw: string;
  let lines: string[];

  beforeAll(() => {
    raw = fs.readFileSync(RUNBOOK_PATH, 'utf8');
    lines = raw.split(/\r?\n/);
  });

  it('is readable UTF-8 with zero mojibake markers', () => {
    expect(raw).not.toMatch(/[ÔÃÂ€]/);
    expect(raw).not.toContain('\uFFFD');
  });

  it('never claims that the build phase applies migrations (criterion #3)', () => {
    const offenders = claimUnits(raw).filter(
      (unit) => BUILD_PHASE_TOKEN.test(unit) && MIGRATION_TOKEN.test(unit),
    );

    expect(offenders).toEqual([]);
  });

  it('names the single versioned migration owner (criterion #1)', () => {
    expect(raw).toContain('backend/package.json');
    expect(raw).toMatch(/migrate:prod/);
    expect(raw).toMatch(/start:prod/);

    // The owner is named in context, not as an orphan path: the line that
    // declares backend/package.json as the owner must name the migration script.
    const ownerLine = lines.find((line) =>
      line.includes('backend/package.json'),
    );
    expect(ownerLine).toBeDefined();
    expect(ownerLine).toMatch(/migrate:prod/);
  });

  it('gives an explicit operator verification step with prisma migrate status (criterion #4)', () => {
    const statusLines = lines.filter((line) =>
      line.includes('prisma migrate status'),
    );

    expect(statusLines.length).toBeGreaterThan(0);
    // The step is a verification of the deploy order, not a passing mention.
    expect(
      statusLines.some((line) =>
        /verific|confirm|comprob|antes de arrancar/i.test(line),
      ),
    ).toBe(true);
  });

  it('routes production provisioning through provision:prod and the admin API (criterion #2)', () => {
    expect(raw).toMatch(/npm run provision:prod/);
    expect(raw).toMatch(/POST \/api\/admin\/organizations/);
  });

  it('never routes production provisioning through the development seed (criterion #2)', () => {
    const offenders = lines.filter((line) =>
      DEVELOPMENT_SEED_INSTRUCTION.test(line),
    );

    expect(offenders).toEqual([]);
  });

  it('keeps the explicitly opted-in test-organization seed allowed', () => {
    // Precision guard for the rule above: the test-organization seed is an
    // explicit opt-in (SEED_ALLOW_NON_DEV + a password) and must not be caught
    // by it.
    expect('railway run npm run seed:test-orgs:prod').not.toMatch(
      DEVELOPMENT_SEED_INSTRUCTION,
    );
    expect('railway run npm run seed').toMatch(DEVELOPMENT_SEED_INSTRUCTION);
  });

  it('does not present public self-registration as a bootstrap path', () => {
    const offenders = lines.filter((line) => /auth\/register/i.test(line));

    expect(offenders).toEqual([]);
  });
});
