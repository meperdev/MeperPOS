import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009170000_payroll_shift_membership/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural checks only: these do not execute PostgreSQL or prove concurrency.
describe('unwired payroll shift membership', () => {
  it('declares historical membership and both composite relations', () => {
    const membership = model('PayrollShiftMembership');
    expect(membership).toMatch(/releasedAt\s+DateTime\?/);
    expect(membership).toContain(
      'fields: [shiftId, organizationId, employeeId], references: [id, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(membership).toContain(
      'fields: [obligationId, organizationId, employeeId, obligationKind], references: [id, organizationId, employeeId, kind], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(model('EmployeeShift')).toContain(
      '@@unique([id, organizationId, employeeId])',
    );
    expect(model('PayrollObligation')).toContain(
      '@@unique([id, organizationId, employeeId, kind])',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("shiftId", "organizationId", "employeeId") REFERENCES "EmployeeShift"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("obligationId", "organizationId", "employeeId", "obligationKind") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId", "kind") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it('maps Prisma relation and index names to the migration', () => {
    const membership = model('PayrollShiftMembership');
    expect(membership).toMatch(
      /shift\s+EmployeeShift\s+@relation\([^\n]*map: "PayrollShiftMembership_shift_fkey"\)/,
    );
    expect(membership).toMatch(
      /obligation\s+PayrollObligation\s+@relation\([^\n]*map: "PayrollShiftMembership_obligation_fkey"\)/,
    );
    expect(membership).toContain(
      '@@index([obligationId, organizationId, employeeId, obligationKind], map: "PayrollShiftMembership_obligation_idx")',
    );
    expect(sql).toContain(
      'CONSTRAINT "PayrollShiftMembership_shift_fkey" FOREIGN KEY ("shiftId", "organizationId", "employeeId")',
    );
    expect(sql).toContain(
      'CONSTRAINT "PayrollShiftMembership_obligation_fkey" FOREIGN KEY ("obligationId", "organizationId", "employeeId", "obligationKind")',
    );
    expect(sql).toMatch(
      /CREATE INDEX "PayrollShiftMembership_obligation_idx"\s+ON "PayrollShiftMembership"\("obligationId", "organizationId", "employeeId", "obligationKind"\)/,
    );
  });

  it('accepts only shift groups and at most one unreleased membership per shift', () => {
    expect(sql).toContain('CHECK ("obligationKind" = \'SHIFT_GROUP\')');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "PayrollShiftMembership_active_shift_key"\s+ON "PayrollShiftMembership"\("shiftId"\) WHERE "releasedAt" IS NULL/,
    );
  });

  it('protects identity and history while allowing a one-way release seam', () => {
    for (const field of [
      'id',
      'shiftId',
      'obligationId',
      'organizationId',
      'employeeId',
      'obligationKind',
      'createdAt',
    ]) {
      expect(sql).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    expect(sql).toContain(
      'OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"',
    );
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "PayrollShiftMembership"/);
    expect(sql).toContain("TG_OP = 'DELETE'");
    expect(sql).not.toMatch(
      /CREATE TABLE "[^\"]*(?:Installment|Payment|Expense)/i,
    );
  });
});
