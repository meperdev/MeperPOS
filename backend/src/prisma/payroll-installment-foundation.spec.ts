import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009180000_payroll_installment_foundation/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Declaration checks only; PostgreSQL behavior and correction workflows are untested.
describe('unwired payroll installment foundation', () => {
  it('declares independent cash events with positive finite amount, date, method and tenant actor', () => {
    const event = model('PayrollCashOutflow');
    expect(event).toMatch(/amount\s+Decimal\s+@db.Decimal\s*\n/);
    expect(event).toMatch(/date\s+DateTime\s+@db.Date/);
    expect(event).toMatch(/method\s+PaymentMethod/);
    expect(event).toContain(
      'fields: [actorId, organizationId], references: [userId, organizationId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it('stores uncapped finite positive cash amounts with at most two decimal places', () => {
    expect(sql).toContain('"amount" NUMERIC NOT NULL');
    expect(sql).toContain('"amount" > 0');
    expect(sql).toContain('"amount" < \'Infinity\'::numeric');
    expect(sql).toContain('scale("amount") <= 2');
  });

  it('ties every installment reference to the same employee and tenant as its event and obligation', () => {
    const link = model('PayrollInstallment');
    expect(link).toContain(
      'fields: [outflowId, organizationId, employeeId], references: [id, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(link).toContain(
      'fields: [obligationId, organizationId, employeeId], references: [id, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("outflowId", "organizationId", "employeeId") REFERENCES "PayrollCashOutflow"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("obligationId", "organizationId", "employeeId") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it('preserves event identity while allowing references from different obligations', () => {
    expect(model('PayrollCashOutflow')).toContain(
      '@@unique([id, organizationId, employeeId], map: "PayrollCashOutflow_identity_key")',
    );
    expect(model('PayrollObligation')).toContain(
      '@@unique([id, organizationId, employeeId])',
    );
    expect(model('PayrollInstallment')).toContain(
      '@@unique([obligationId, outflowId], map: "PayrollInstallment_obligation_outflow_key")',
    );
    expect(model('PayrollInstallment')).not.toMatch(
      /outflowId\s+String\s+@unique/,
    );
    expect(sql).toContain(
      'ON "PayrollInstallment"("obligationId", "outflowId")',
    );
    expect(sql).toContain('NEW."id" IS DISTINCT FROM OLD."id"');
    expect(sql).toContain(
      'NEW."organizationId" IS DISTINCT FROM OLD."organizationId"',
    );
    expect(sql).toContain('NEW."employeeId" IS DISTINCT FROM OLD."employeeId"');
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "PayrollCashOutflow"/);
    expect(sql).toContain("TG_OP = 'DELETE'");
  });
});
