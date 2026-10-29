import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009160000_payroll_obligation_foundation/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural checks only; neither PostgreSQL behavior nor concurrency is exercised.
describe('unwired payroll obligation foundation', () => {
  it('declares the two obligation kinds, pending/completed state and CAS version', () => {
    expect(schema).toMatch(
      /enum PayrollObligationKind\s*\{\s*SHIFT_GROUP\s+FIXED_PERIOD\s*\}/,
    );
    expect(schema).toMatch(
      /enum PayrollObligationStatus\s*\{\s*PENDING\s+COMPLETED\s*\}/,
    );
    expect(model('PayrollObligation')).toMatch(
      /status\s+PayrollObligationStatus\s+@default\(PENDING\)/,
    );
    expect(model('PayrollObligation')).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(sql).toContain('"version" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain(
      '"status" "PayrollObligationStatus" NOT NULL DEFAULT \'PENDING\'',
    );
  });

  it('stores manual fixed-period dates and unrestricted numeric amount without an aggregate cap', () => {
    const obligation = model('PayrollObligation');
    expect(obligation).toMatch(/periodStart\s+DateTime\?\s+@db\.Date/);
    expect(obligation).toMatch(/periodEnd\s+DateTime\?\s+@db\.Date/);
    expect(obligation).toMatch(
      /periodAmount\s+Decimal\?\s+@db\.Decimal\b(?!\()/,
    );
    expect(sql).toContain('"periodAmount" NUMERIC');
    expect(sql).not.toMatch(/DECIMAL\s*\(12\s*,\s*2\)/i);
    expect(sql).toContain(
      '"kind" = \'FIXED_PERIOD\' AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodAmount" IS NOT NULL',
    );
    expect(sql).toContain(
      '"kind" = \'SHIFT_GROUP\' AND "periodStart" IS NULL AND "periodEnd" IS NULL AND "periodAmount" IS NULL',
    );
    expect(sql).not.toMatch(/"periodStart"\s*(?:<|>)|"periodAmount"\s*(?:<|>)/);
  });

  it('references the employee within its organization and preserves ownership', () => {
    expect(model('PayrollObligation')).toContain(
      'fields: [employeeId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain('NEW."employeeId" IS DISTINCT FROM OLD."employeeId"');
    expect(sql).toContain(
      'NEW."organizationId" IS DISTINCT FROM OLD."organizationId"',
    );
    expect(sql).toMatch(
      /BEFORE UPDATE ON "PayrollObligation"\s+FOR EACH ROW EXECUTE FUNCTION "protect_payroll_obligation_ownership"\(\)/,
    );
  });

  it('remains additive without installments, membership or correction lineage', () => {
    expect(sql).toContain('CREATE TABLE "PayrollObligation"');
    expect(sql).not.toMatch(
      /(?:ALTER TABLE "(?:Employee|EmployeeShift)"|DROP TABLE|DELETE FROM|CREATE TABLE "[^"]*(?:Installment|Lineage))/i,
    );
    expect(model('Employee')).not.toMatch(
      /\b(?:userId|User|OrganizationUser)\b/,
    );
    expect(model('PayrollObligation')).not.toMatch(
      /\b(?:shiftId|installmentId|predecessorId|successorId)\b/,
    );
  });
});
