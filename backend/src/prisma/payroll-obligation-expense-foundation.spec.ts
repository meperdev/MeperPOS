import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schemaPath = resolve(__dirname, '../../prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009240000_payroll_obligation_expense/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural checks only. This foundation is unwired storage: no expense
// creation, cash movement, report aggregation or migration execution is proven
// here, and PostgreSQL behavior requires separate evidence.
describe('unwired payroll obligation expense link', () => {
  it('allows at most one expense per obligation and never shares an expense', () => {
    const link = model('PayrollObligationExpense');
    // The identity tuple carries the tenant, so the key and the relation target
    // are the same fact. obligationId is a payroll obligation uuid, so one row
    // per tuple is one row per obligation.
    expect(link).toContain(
      '@@id([obligationId, organizationId, employeeId], map: "PayrollObligationExpense_pkey")',
    );
    // organizationId is pinned to the expense by the composite FK, so this also
    // prevents the same expense from serving a second obligation.
    expect(link).toContain(
      '@@unique([expenseId, organizationId], map: "PayrollObligationExpense_expense_key")',
    );
    expect(sql).toContain(
      'CONSTRAINT "PayrollObligationExpense_pkey" PRIMARY KEY ("obligationId", "organizationId", "employeeId")',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "PayrollObligationExpense_expense_key" ON "PayrollObligationExpense"("expenseId", "organizationId");',
    );
  });

  it('binds obligation and expense to the same tenant through composite keys', () => {
    const link = model('PayrollObligationExpense');
    expect(link).toContain(
      'fields: [obligationId, organizationId, employeeId], references: [id, organizationId, employeeId]',
    );
    expect(link).toContain(
      'fields: [expenseId, organizationId], references: [id, organizationId]',
    );
    expect(model('PayrollObligation')).toContain(
      '@@unique([id, organizationId, employeeId])',
    );
    // The expense side needs an explicit target key because Expense has no
    // tenant-bearing unique constraint of its own.
    expect(model('Expense')).toContain(
      '@@unique([id, organizationId], map: "Expense_payroll_target_key")',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "Expense_payroll_target_key" ON "Expense"("id", "organizationId");',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("obligationId", "organizationId", "employeeId") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("expenseId", "organizationId") REFERENCES "Expense"("id", "organizationId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")',
    );
  });

  it('refuses deletion and rekeying of either referenced record instead of losing the link', () => {
    const link = model('PayrollObligationExpense');
    const relations = link
      .split('\n')
      .filter((line) => line.includes('@relation('))
      .join('\n');
    expect(relations).not.toMatch(/onDelete:\s*Cascade/);
    expect(relations).not.toMatch(/onUpdate:\s*(?:Cascade|SetNull)/);
    expect(relations.match(/onDelete:\s*Restrict/g)).toHaveLength(3);
    expect(relations.match(/onUpdate:\s*Restrict/g)).toHaveLength(3);

    const foreignKeys = sql
      .split(';')
      .filter((statement) => /\bFOREIGN KEY\b/i.test(statement))
      .map((statement) => statement.replace(/\s+/g, ' ').trim());
    expect(foreignKeys).toHaveLength(3);
    for (const statement of foreignKeys) {
      expect(statement).toMatch(
        /^ALTER TABLE "PayrollObligationExpense" ADD CONSTRAINT "PayrollObligationExpense_[a-z]+_fkey"/,
      );
      expect(statement).toContain('ON DELETE RESTRICT ON UPDATE RESTRICT');
      expect(statement).not.toMatch(/REFERENCES "PayrollObligationExpense"/);
    }
  });

  it('adds no per-installment cash mirror and no amount of its own', () => {
    const link = model('PayrollObligationExpense');
    expect(link).not.toBe('');
    expect(sql).not.toBe('');
    expect(link).not.toMatch(
      /\b(amount|total|date|method|installmentId|outflowId|periodAmount)\b/,
    );
    expect(sql).not.toMatch(
      /\b(amount|total|method|"installmentId"|"outflowId"|"periodAmount")\b/i,
    );
    expect(model('PayrollInstallment')).not.toMatch(
      /expenseId|PayrollObligationExpense/,
    );
    expect(link).not.toMatch(/PayrollInstallment|PayrollCashOutflow/);
  });

  it('keeps existing rows untouched and rewrites no financial data', () => {
    expect(sql).not.toBe('');
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|DROP)\b/i,
    );
    expect(statements).not.toMatch(/ALTER TABLE "PayrollObligation"/);
    expect(statements).not.toMatch(/ALTER TABLE "Expense"/);
    expect(statements).not.toMatch(/ALTER TABLE "ExpensePayment"/);
    expect(statements).not.toMatch(/ALTER TABLE "Organization"/);
    // Annulment stays a soft delete of the expense; the link is not rewritten.
    expect(model('Expense')).toMatch(
      /^\s*active\s+Boolean\s+@default\(true\)/m,
    );
  });

  it('protects the link row itself as append-only evidence', () => {
    // Parent RESTRICT only stops the obligation or the expense from going away;
    // without a row trigger this evidence row could be repointed or removed.
    const triggerStart = sql.indexOf(
      'CREATE TRIGGER "PayrollObligationExpense_history"',
    );
    expect(triggerStart).toBeGreaterThan(-1);
    const trigger = sql.slice(triggerStart, sql.indexOf(';', triggerStart) + 1);
    expect(trigger).toContain(
      'BEFORE UPDATE OR DELETE ON "PayrollObligationExpense"',
    );
    expect(trigger).toContain('FOR EACH ROW');
    // Column-limited triggers would leave other columns writable.
    expect(trigger).not.toContain('UPDATE OF');

    const functionName = trigger.match(/EXECUTE FUNCTION "([a-z_]+)"\(\)/)?.[1];
    expect(functionName).toBeTruthy();
    const functionStart = sql.indexOf(`CREATE FUNCTION "${functionName}"`);
    const functionEnd = sql.indexOf('$$ LANGUAGE plpgsql', functionStart);
    expect(functionStart).toBeGreaterThan(-1);
    const body = sql.slice(functionStart, functionEnd);
    // Unconditional rejection: no row branching that could allow an update.
    expect(body).toContain('RAISE EXCEPTION');
    expect(body).not.toMatch(/\b(?:NEW|OLD)\b/);

    // Exactly one trigger is created, so no permissive trigger shadows this one.
    expect(sql.split('CREATE TRIGGER')).toHaveLength(2);
  });

  it('documents the trigger boundaries instead of claiming full immutability', () => {
    // TRUNCATE and privileged bypass are not guarded by a row trigger, and
    // administrative cleanup of a link row is now blocked on purpose.
    expect(sql).toMatch(/TRUNCATE/);
    expect(sql).toMatch(/privileged bypass/i);
    expect(sql).toMatch(/administrative cleanup/i);
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/TRUNCATE/i);

    // A replacement obligation copy would need its own link row; neither the
    // annulment protocol nor expense-copy support is established here.
    expect(sql).toMatch(/pending copy/i);
    expect(sql).toMatch(/not established|is not implemented/i);
    expect(schema).toMatch(/append-only trigger/);
    expect(statements).not.toMatch(/PayrollInstallment|PayrollCashOutflow/);
  });

  it('leaves the required expense-payment contract and Decimal(12,2) limits visible', () => {
    // The existing expense service requires at least one ExpensePayment and
    // Expense.total is Decimal(12,2) while payroll aggregates may exceed it.
    // This storage foundation does not relax or reinterpret either limit.
    expect(model('Expense')).toMatch(
      /^\s*total\s+Decimal\s+@db\.Decimal\(12, 2\)$/m,
    );
    const payment = model('ExpensePayment');
    expect(payment).toMatch(/^\s*expenseId\s+String$/m);
    expect(payment).toMatch(/^\s*amount\s+Decimal\s+@db\.Decimal\(12, 2\)$/m);
    expect(payment).toContain('references: [id], onDelete: Cascade');
    // The payment requirement comes from the expense service, not from a
    // database constraint, and this table does not relax it.
    expect(sql).toMatch(/the expense service requires it/i);
    const link = model('PayrollObligationExpense');
    expect(link).not.toBe('');
    expect(link).not.toMatch(/Decimal|payments/);
  });
});
