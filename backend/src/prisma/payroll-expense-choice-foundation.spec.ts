import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009220000_payroll_expense_choice/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const obligation =
  schema.split('model PayrollObligation {')[1]?.split('\n}')[0] ?? '';

// Structural only: no PostgreSQL migration, persistence or integration proof.
describe('unwired payroll expense choice storage', () => {
  it('stores nullable choice and optional date on the obligation without defaults', () => {
    expect(obligation).toMatch(/^\s*expenseEnabled\s+Boolean\?\s*$/m);
    expect(obligation).toMatch(
      /^\s*selectedExpenseDate\s+DateTime\?\s+@db\.Date\s*$/m,
    );
  });

  it('adds matching nullable columns without rewriting legacy rows or imposing choice-dependent checks', () => {
    const statements = sql
      .replace(/--[^\n]*/g, '')
      .trim()
      .replace(/\s+/g, ' ');
    expect(statements).toBe(
      'ALTER TABLE "PayrollObligation" ADD COLUMN "expenseEnabled" BOOLEAN, ADD COLUMN "selectedExpenseDate" DATE;',
    );
  });

  it('keeps the decision on the shared obligation rather than individual installments', () => {
    const installment =
      schema.split('model PayrollInstallment {')[1]?.split('\n}')[0] ?? '';
    expect(obligation).toMatch(/installments\s+PayrollInstallment\[\]/);
    expect(installment).not.toMatch(/expenseEnabled|selectedExpenseDate/);
    expect(installment).toMatch(/obligation\s+PayrollObligation\s+@relation/);
  });
});
