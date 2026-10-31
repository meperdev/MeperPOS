import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009190000_payroll_allocation_foundation/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural evidence only; actual PostgreSQL behavior and lifecycle are future work.
describe('unwired payroll allocation foundation', () => {
  it('links both parents through the same obligation, tenant and employee', () => {
    const allocation = model('PayrollAllocation');
    for (const parent of ['installment', 'membership']) {
      expect(allocation).toContain(
        `fields: [${parent}Id, obligationId, organizationId, employeeId], references: [id, obligationId, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict`,
      );
    }
    for (const [parent, column] of [
      ['PayrollInstallment', 'installmentId'],
      ['PayrollShiftMembership', 'membershipId'],
    ]) {
      expect(model(parent)).toContain(
        '@@unique([id, obligationId, organizationId, employeeId]',
      );
      expect(sql).toContain(
        `FOREIGN KEY ("${column}", "obligationId", "organizationId", "employeeId") REFERENCES "${parent}"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT`,
      );
      expect(sql).toContain(
        `ON "${parent}"("id", "obligationId", "organizationId", "employeeId")`,
      );
    }
  });

  it('requires exact positive finite cents within the individual shift limit', () => {
    expect(model('PayrollAllocation')).toMatch(
      /amount\s+Decimal\s+@db.Decimal\s*\n/,
    );
    expect(sql).toContain('"amount" NUMERIC NOT NULL');
    expect(sql).toContain('"amount" > 0');
    expect(sql).toContain('"amount" <= 9999999999.99');
    expect(sql).toContain('scale("amount") <= 2');
  });

  it('keeps allocations immutable while allowing a replacement for the same pair', () => {
    expect(model('PayrollAllocation')).not.toMatch(
      /@@unique\(\[installmentId, membershipId\]/,
    );
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "PayrollAllocation"\("installmentId", "membershipId"\)/,
    );
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "PayrollAllocation"/);
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Payroll allocation history cannot be changed or deleted'/,
    );
  });

  it('records at most one immutable void fact per allocation scoped to the same obligation and owner', () => {
    const fact = model('PayrollAllocationVoid');
    expect(fact).toContain(
      'fields: [allocationId, obligationId, organizationId, employeeId], references: [id, obligationId, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(fact).toContain(
      '@@unique([allocationId], map: "PayrollAllocationVoid_allocation_key")',
    );
    expect(fact).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model('PayrollAllocation')).toContain(
      '@@unique([id, obligationId, organizationId, employeeId], map: "PayrollAllocation_void_target_key")',
    );
    expect(sql).toContain(
      'ON "PayrollAllocation"("id", "obligationId", "organizationId", "employeeId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("allocationId", "obligationId", "organizationId", "employeeId") REFERENCES "PayrollAllocation"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain('ON "PayrollAllocationVoid"("allocationId")');
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "PayrollAllocationVoid"/);
    expect(sql).toContain(
      "RAISE EXCEPTION 'Payroll allocation void history cannot be changed or deleted'",
    );
  });

  it('leaves release and successor copying possible without creating a cash event', () => {
    expect(model('PayrollAllocation')).not.toContain('outflowId');
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) "PayrollCashOutflow"/,
    );
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) "PayrollShiftMembership"/);
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) "PayrollInstallment"/);
    expect(model('PayrollInstallment')).toContain('outflowId');
  });
});
