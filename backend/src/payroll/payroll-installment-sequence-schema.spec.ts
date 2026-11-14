import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migrationDir = resolve(
  __dirname,
  '../../prisma/migrations/20261009270000_payroll_installment_sequence',
);
const sqlPath = resolve(migrationDir, 'migration.sql');
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';
const installment = () => model('PayrollInstallment');
const sequenceLine = () =>
  installment()
    .split('\n')
    .findIndex((line) => /^\s*sequence\s+Int\?$/.test(line));

// Structural checks only: no database connection, no migration execution.
// The persisted registration order is the only defensible ordering evidence for
// grouped installments (decision L332); legacy rows never had it (L333).
describe('payroll installment registration sequence storage', () => {
  it('adds a nullable sequence without inventing an order for existing rows', () => {
    expect(existsSync(sqlPath)).toBe(true);
    expect(installment()).not.toBe('');
    expect(sequenceLine()).toBeGreaterThan(-1);
    expect(installment()).toMatch(/^\s*sequence\s+Int\?$/m);
    expect(installment()).not.toMatch(/sequence\s+Int\?\s+@default/);
    expect(sql).toMatch(
      /ALTER TABLE "PayrollInstallment"\s+ADD COLUMN "sequence" INTEGER;/,
    );
    // Nullable on purpose: no NOT NULL, no default, no zero placeholder.
    expect(sql).not.toMatch(/"sequence"\s+INTEGER\s+NOT NULL/i);
    expect(sql).not.toMatch(/"sequence"[^,\n]*DEFAULT/i);
    expect(sql).not.toMatch(/"sequence"[^,\n]*COALESCE/i);
    // No inferred or fabricated legacy order: nothing is written to old rows.
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
  });

  it('documents that a null sequence keeps corrections fail-closed', () => {
    expect(sequenceLine()).toBeGreaterThan(0);
    const comment = installment()
      .split('\n')
      .slice(Math.max(0, sequenceLine() - 8), sequenceLine())
      .join('\n');
    expect(comment).toMatch(/inferred/i);
    expect(comment).toMatch(/fail closed/i);
    expect(comment).toMatch(/NULL/);
  });

  it('scopes uniqueness per tenant, employee and obligation rather than globally', () => {
    expect(installment()).toContain(
      '@@unique([obligationId, organizationId, employeeId, sequence], map: "PayrollInstallment_obligation_sequence_key")',
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "PayrollInstallment_obligation_sequence_key"\s+ON "PayrollInstallment"\("obligationId", "organizationId", "employeeId", "sequence"\)/,
    );
    // The sequence is per obligation, not per employee or global.
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*\("sequence"\)/);
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*\("employeeId", "sequence"\)/,
    );
  });

  it('requires a positive sequence whenever one is stored', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT "PayrollInstallment_sequence_check"\s+CHECK \("sequence" IS NULL OR "sequence" > 0\)/,
    );
  });

  it('is additive and leaves existing installment identity and other payroll tables alone', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE/i);
    // Only the installment table is altered, twice: column then check.
    const alters = [...sql.matchAll(/ALTER TABLE "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(alters).toEqual(['PayrollInstallment', 'PayrollInstallment']);
    // Existing installment keys, indexes and relations are untouched.
    for (const existing of [
      'PayrollInstallment_obligation_outflow_key',
      'PayrollInstallment_allocation_target_key',
      'PayrollInstallment_revision_target_key',
      'PayrollInstallment_outflow_idx',
    ])
      expect(sql).not.toContain(existing);
    expect(installment()).toContain(
      '@@unique([obligationId, outflowId], map: "PayrollInstallment_obligation_outflow_key")',
    );
    // Prisma Migrate already runs the migration in a transaction; nesting an
    // explicit one is what L192 flagged as unverified behaviour.
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
  });
});
