import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migrationsDir = resolve(__dirname, '../../prisma/migrations');
const migrationDir = resolve(
  migrationsDir,
  '20261009260000_payroll_cash_return',
);
const sqlPath = resolve(migrationDir, 'migration.sql');
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural checks only: no database connection, no migration execution.
describe('payroll cash return storage foundation', () => {
  it('stores real returns in an append-only table separate from in-place revisions', () => {
    expect(model('PayrollCashReturn')).not.toBe('');
    expect(sql).toContain('CREATE TABLE "PayrollCashReturn"');
    expect(model('PayrollCashRevision')).not.toBe('');
    expect(model('PayrollCashReturn')).not.toMatch(/\brevisions\b/);
    expect(sql).not.toMatch(
      /(?:CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|CREATE FUNCTION|CREATE TRIGGER|ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM)[^;]*"PayrollCashRevision"/,
    );
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "PayrollCashReturn"');
    expect(sql).not.toMatch(
      /BEFORE (?:UPDATE|DELETE|INSERT) ON "PayrollCashRevision"/,
    );
  });

  it('retains tenant, employee, obligation and outflow identity through the restricted installment reference', () => {
    expect(model('PayrollInstallment')).toContain(
      '@@unique([id, obligationId, outflowId, organizationId, employeeId], map: "PayrollInstallment_revision_target_key")',
    );
    const cashReturn = model('PayrollCashReturn');
    for (const field of [
      'organizationId',
      'employeeId',
      'installmentId',
      'obligationId',
      'outflowId',
    ]) {
      expect(cashReturn).toMatch(new RegExp(`${field}\\s+String`));
      expect(sql).toContain(`"${field}" TEXT NOT NULL`);
    }
    expect(cashReturn).toContain(
      'fields: [installmentId, obligationId, outflowId, organizationId, employeeId], references: [id, obligationId, outflowId, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("installmentId", "obligationId", "outflowId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    // The identity target already exists; this migration adds no index there.
    expect(sql).not.toMatch(/ON "PayrollInstallment"/);
  });

  it('attributes the return to a member of the same tenant and blocks removing that reference', () => {
    expect(model('PayrollCashReturn')).toContain(
      'fields: [actorId, organizationId], references: [userId, organizationId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).not.toMatch(/PayrollCashReturn[\s\S]*ON DELETE CASCADE/);
  });

  it('records the actual day the money came back together with the original payment facts', () => {
    const cashReturn = model('PayrollCashReturn');
    expect(cashReturn).toMatch(/returnDate\s+DateTime\s+@db\.Date/);
    expect(cashReturn).toMatch(/originalDate\s+DateTime\s+@db\.Date/);
    expect(cashReturn).toMatch(/originalMethod\s+PaymentMethod/);
    expect(cashReturn).toMatch(/originalAmount\s+Decimal\s+@db\.Decimal/);
    expect(cashReturn).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(sql).toContain('"returnDate" DATE NOT NULL');
    expect(sql).toContain('"originalDate" DATE NOT NULL');
    expect(sql).toContain('"originalMethod" "PaymentMethod" NOT NULL');
    expect(sql).toContain('"originalAmount" NUMERIC NOT NULL');
    expect(sql).toContain(
      '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  it('requires the real method the money came back by, distinct from the original payment method', () => {
    const cashReturn = model('PayrollCashReturn');
    // Approved decision L330: the actor chooses the actual return method.
    expect(cashReturn).toMatch(/^\s*returnMethod\s+PaymentMethod\s*$/m);
    expect(sql).toContain('"returnMethod" "PaymentMethod" NOT NULL');
    // It is separate evidence, not a rename of the original payment method.
    expect(cashReturn).toMatch(/^\s*originalMethod\s+PaymentMethod\s*$/m);
    expect(sql).toContain('"originalMethod" "PaymentMethod" NOT NULL');
    expect(cashReturn).not.toMatch(/returnMethod\s+PaymentMethod\s*\?/);
    // The returned money keeps its own method: no default and no column-level
    // fallback to the original method, so the writer must state it.
    expect(sql).not.toMatch(/"returnMethod"[^,\n]*DEFAULT/i);
    expect(sql).not.toMatch(/"returnMethod"[^\n]*"originalMethod"/i);
    // Schema field order and table column order stay in step.
    expect(cashReturn.indexOf('originalMethod')).toBeLessThan(
      cashReturn.indexOf('returnMethod'),
    );
    expect(cashReturn.indexOf('returnMethod')).toBeLessThan(
      cashReturn.indexOf('returnDate'),
    );
    expect(sql.indexOf('"originalMethod"')).toBeLessThan(
      sql.indexOf('"returnMethod"'),
    );
    expect(sql.indexOf('"returnMethod"')).toBeLessThan(
      sql.indexOf('"returnDate"'),
    );
  });

  it('allows a single full return per installment and does not model partial returns', () => {
    expect(model('PayrollCashReturn')).toContain(
      '@@unique([installmentId, obligationId, outflowId, organizationId, employeeId], map: "PayrollCashReturn_installment_key")',
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "PayrollCashReturn_installment_key"\s+ON "PayrollCashReturn"\("installmentId", "obligationId", "outflowId", "organizationId", "employeeId"\)/,
    );
    // Approved decision L329: one return covers exactly one complete
    // installment of the completed payment, never an obligation-level total.
    expect(model('PayrollCashReturn')).not.toMatch(
      /^\s*(?:obligationAmount|paymentAmount|totalAmount|paidAmount)\s/im,
    );
    expect(sql).not.toMatch(/"(?:obligationAmount|paymentAmount|totalAmount)"/);
    expect(model('PayrollCashReturn')).not.toMatch(
      /@@unique\(\[(?:outflowId|obligationId)\]/,
    );
    // No partial-return storage: no remaining/partial/refund column exists.
    expect(model('PayrollCashReturn')).not.toMatch(
      /^\s*(?:partial|refund|remaining|pending|outstanding)\w*\s/im,
    );
    expect(sql).not.toMatch(/^\s*"(?:partial|refund|remaining)\w*"/im);
  });

  it('requires positive finite returned and original amounts with at most two decimal places', () => {
    for (const field of ['amount', 'originalAmount']) {
      expect(model('PayrollCashReturn')).toMatch(
        new RegExp(`${field}\\s+Decimal\\s+@db\\.Decimal`),
      );
      expect(sql).toContain(`"${field}" NUMERIC NOT NULL`);
      expect(sql).toContain(`CHECK ("${field}" > 0`);
      expect(sql).toContain(`"${field}" < 'Infinity'::numeric`);
      expect(sql).toContain(`scale("${field}") <= 2`);
    }
  });

  it('rejects updates and deletes of return facts', () => {
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON "PayrollCashReturn"[\s\S]*FOR EACH ROW EXECUTE FUNCTION/,
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'Payroll cash return history cannot be changed or deleted'",
    );
    expect(model('PayrollCashReturn')).not.toMatch(/updatedAt/);
  });

  it('is additive: it never rewrites applied payroll, expense or cash rows', () => {
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|ALTER TABLE|DROP TABLE)[^;]*"(?:PayrollCashOutflow|PayrollInstallment|PayrollCashRevision|PayrollAllocation|PayrollAllocationVoid|PayrollObligation|PayrollObligationExpense|Expense)"/i,
    );
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it('follows its prerequisite and uniquely defines the return table', () => {
    const dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const prerequisite = dirs.indexOf('20261009250000_expense_label_index');
    const returnMigration = dirs.indexOf('20261009260000_payroll_cash_return');
    expect(prerequisite).toBeGreaterThanOrEqual(0);
    expect(returnMigration).toBeGreaterThan(prerequisite);
    const declared = dirs
      .filter((dir) =>
        readFileSync(
          resolve(migrationsDir, dir, 'migration.sql'),
          'utf8',
        ).includes('PayrollCashReturn'),
      )
      .map((dir) => dir);
    expect(declared).toEqual(['20261009260000_payroll_cash_return']);
  });
});
