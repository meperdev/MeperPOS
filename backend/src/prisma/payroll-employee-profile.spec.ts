import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migration = resolve(
  __dirname,
  '../../prisma/migrations/20261009130000_payroll_employee_profile/migration.sql',
);
const sql = existsSync(migration) ? readFileSync(migration, 'utf8') : '';
const employee = schema.split('model Employee {')[1]?.split('\n}')[0] ?? '';

// Structural declarations only; these tests do not execute the migration.
describe('employee profile persistence declarations', () => {
  it('adds nullable identity, contact and employment details for existing employees', () => {
    for (const field of [
      'identification',
      'phone',
      'email',
      'address',
      'jobTitle',
    ]) {
      expect(employee).toMatch(new RegExp(`\\b${field}\\s+String\\?`));
      expect(sql).toContain(`ADD COLUMN "${field}" TEXT`);
    }
    expect(employee).toMatch(/\bstartDate\s+DateTime\?\s+@db\.Date/);
    expect(sql).toContain('ADD COLUMN "startDate" DATE');
    expect(sql).not.toMatch(/\b(?:NOT NULL|DEFAULT)\b/i);
  });

  it('records an optional modality and reference amount without calculating pay', () => {
    expect(schema).toMatch(
      /enum EmployeeRemunerationModality\s*\{\s*FIXED\s+BY_DAY\s+OTHER\s*\}/,
    );
    expect(employee).toMatch(
      /\bremunerationModality\s+EmployeeRemunerationModality\?/,
    );
    expect(employee).toMatch(
      /\breferenceAmount\s+Decimal\?\s+@db\.Decimal\(12, 2\)/,
    );
    expect(sql).toContain(
      "CREATE TYPE \"EmployeeRemunerationModality\" AS ENUM ('FIXED', 'BY_DAY', 'OTHER')",
    );
    expect(sql).toContain(
      'ADD COLUMN "remunerationModality" "EmployeeRemunerationModality"',
    );
    expect(sql).toContain('ADD COLUMN "referenceAmount" DECIMAL(12,2)');
    expect(sql).toContain(
      '"referenceAmount" >= 0 AND "referenceAmount" <> \'NaN\'::numeric',
    );
  });

  it('is additive and preserves independent tenant-owned identities and shifts', () => {
    expect(employee).not.toMatch(/\b(?:userId|User|OrganizationUser)\b/);
    expect(employee).toContain('@@unique([id, organizationId])');
    expect(employee).toContain('onDelete: Restrict, onUpdate: Restrict');
    expect(sql).toContain('ALTER TABLE "Employee"');
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE|TRIGGER|FUNCTION)\b/i);
    expect(sql).not.toMatch(
      /ALTER TABLE "(?:EmployeeShift|Organization|User|OrganizationUser)"/,
    );
  });
});
