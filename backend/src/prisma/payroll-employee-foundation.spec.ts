import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009120000_payroll_employee_foundation/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Declaration checks only: they do not execute PostgreSQL or prove concurrency.
describe('employee and manual shift foundation declarations', () => {
  it('stores independent employee identities with a soft inactive state', () => {
    expect(model('Employee')).toMatch(/active\s+Boolean\s+@default\(true\)/);
    expect(model('Employee')).toMatch(/name\s+String/);
    expect(model('Employee')).not.toMatch(
      /\b(?:userId|User|OrganizationUser)\b/,
    );
    expect(sql).toContain('CREATE TABLE "Employee"');
    expect(sql).toContain('"active" BOOLEAN NOT NULL DEFAULT true');
  });

  it('records full or partial shifts, calendar dates and decimal agreed amounts', () => {
    expect(schema).toMatch(
      /enum EmployeeShiftKind\s*\{\s*FULL_DAY\s+PARTIAL_DAY\s*\}/,
    );
    expect(model('EmployeeShift')).toMatch(/date\s+DateTime\s+@db\.Date/);
    expect(model('EmployeeShift')).toMatch(
      /amount\s+Decimal\s+@db\.Decimal\(12, 2\)/,
    );
    expect(sql).toContain(
      "CREATE TYPE \"EmployeeShiftKind\" AS ENUM ('FULL_DAY', 'PARTIAL_DAY')",
    );
    expect(sql).toContain('"date" DATE NOT NULL');
    expect(sql).toContain('"amount" DECIMAL(12,2) NOT NULL');
    expect(sql).toContain('"amount" >= 0 AND "amount" <> \'NaN\'::numeric');
  });

  it('enforces one shift per employee and calendar date and tenant-safe references', () => {
    expect(model('Employee')).toContain('@@unique([id, organizationId])');
    expect(model('EmployeeShift')).toContain(
      '@@unique([organizationId, employeeId, date])',
    );
    expect(model('EmployeeShift')).toContain(
      'fields: [employeeId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'ON "EmployeeShift"("organizationId", "employeeId", "date")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it('prevents employee ownership and shift identity reassignment while permitting detail edits', () => {
    const employeeGuard =
      sql
        .split(
          'CREATE FUNCTION "protect_employee_ownership"() RETURNS trigger AS $$',
        )[1]
        ?.split('$$ LANGUAGE plpgsql;')[0] ?? '';
    const shiftGuard =
      sql
        .split(
          'CREATE FUNCTION "protect_employee_shift_identity"() RETURNS trigger AS $$',
        )[1]
        ?.split('$$ LANGUAGE plpgsql;')[0] ?? '';
    expect(employeeGuard).toContain(
      'NEW."organizationId" IS DISTINCT FROM OLD."organizationId"',
    );
    expect(employeeGuard).toMatch(/RAISE EXCEPTION[\s\S]*RETURN NEW;/);
    expect(sql).toContain(
      'BEFORE UPDATE ON "Employee"\nFOR EACH ROW EXECUTE FUNCTION "protect_employee_ownership"()',
    );
    expect(shiftGuard).toContain(
      'NEW."organizationId" IS DISTINCT FROM OLD."organizationId"',
    );
    expect(shiftGuard).toContain(
      'NEW."employeeId" IS DISTINCT FROM OLD."employeeId"',
    );
    expect(shiftGuard).toMatch(/RAISE EXCEPTION[\s\S]*RETURN NEW;/);
    expect(shiftGuard).not.toMatch(/NEW\."(?:date|kind|amount)"/);
    expect(sql).toContain(
      'BEFORE UPDATE ON "EmployeeShift"\nFOR EACH ROW EXECUTE FUNCTION "protect_employee_shift_identity"()',
    );
  });

  it('checks activity for inserts and actual date changes, not unchanged update fields', () => {
    const activeGuard =
      sql
        .split(
          'CREATE FUNCTION "check_employee_shift_active"() RETURNS trigger AS $$',
        )[1]
        ?.split('$$ LANGUAGE plpgsql;')[0] ?? '';
    expect(activeGuard).toMatch(
      /IF TG_OP = 'UPDATE' THEN\s+IF NEW\."date" IS NOT DISTINCT FROM OLD\."date" THEN\s+RETURN NEW;\s+END IF;\s+END IF;[\s\S]*SELECT "active"[\s\S]*FOR UPDATE[\s\S]*IF employee_active = false THEN\s+RAISE EXCEPTION/,
    );
  });

  it('retains history and serializes new or reassigned shifts against deactivation', () => {
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OF "employeeId", "organizationId", "date" ON "EmployeeShift"',
    );
    expect(sql).toMatch(
      /SELECT "active"[\s\S]*FROM "Employee"[\s\S]*FOR UPDATE/,
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'Inactive employee cannot receive a shift'",
    );
    expect(sql).not.toMatch(
      /\b(?:DELETE FROM|DROP TABLE|ALTER TABLE "(?:User|OrganizationUser|Sale|Payment)")/,
    );
  });
});
