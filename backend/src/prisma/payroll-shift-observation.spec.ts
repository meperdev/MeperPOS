import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migration = resolve(
  __dirname,
  '../../prisma/migrations/20261009140000_payroll_shift_observation/migration.sql',
);
const sql = existsSync(migration) ? readFileSync(migration, 'utf8') : '';
const shift = schema.split('model EmployeeShift {')[1]?.split('\n}')[0] ?? '';

// Structural declarations only; these tests do not execute the migration.
describe('shift observation persistence declarations', () => {
  it('declares an optional observation on shifts', () => {
    expect(shift).toMatch(/^\s*observation\s+String\?\s*$/m);
  });

  it('adds only a nullable text column without changing existing data', () => {
    expect(sql.trim()).toMatch(
      /^ALTER TABLE "EmployeeShift"\s+ADD COLUMN "observation" TEXT;$/,
    );
  });
});
