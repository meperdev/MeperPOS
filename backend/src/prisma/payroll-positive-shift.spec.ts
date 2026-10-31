import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = resolve(
  __dirname,
  '../../prisma/migrations/20261009150000_payroll_positive_shift/migration.sql',
);
const sql = existsSync(migration) ? readFileSync(migration, 'utf8') : '';

// Structural declarations only; these tests do not execute the migration.
describe('positive shift migration', () => {
  it('adds only a NOT VALID positive check without rewriting existing rows', () => {
    const statements = sql.replace(/^\s*--.*$/gm, '').trim();
    expect(statements).toMatch(
      /^ALTER TABLE "EmployeeShift"\s+ADD CONSTRAINT "EmployeeShift_amount_positive_check"\s+CHECK\s*\(\s*"amount"\s*>\s*0\s*\)\s+NOT VALID;$/,
    );
  });

  it('documents the existing-row and subsequent-update caveat', () => {
    expect(sql).toMatch(/existing/i);
    expect(sql).toMatch(/update/i);
    expect(sql).toMatch(/zero/i);
  });
});
