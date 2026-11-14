import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009230000_payroll_expense_category/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural checks only; PostgreSQL behavior requires separate proof.
describe('payroll expense category storage', () => {
  it('allows at most one explicitly assigned label per organization', () => {
    expect(model('PayrollExpenseCategory')).toMatch(
      /organizationId\s+String\s+@id/,
    );
    expect(sql).toContain('PRIMARY KEY ("organizationId")');
  });

  it('binds the exact label and its group to the same tenant', () => {
    expect(model('ExpenseLabel')).toContain(
      '@@unique([id, groupId, organizationId], map: "ExpenseLabel_payroll_target_key")',
    );
    expect(model('ExpenseGroup')).toContain(
      '@@unique([id, organizationId], map: "ExpenseGroup_payroll_target_key")',
    );
    expect(model('PayrollExpenseCategory')).toContain(
      'fields: [labelId, groupId, organizationId], references: [id, groupId, organizationId], onDelete: Cascade, onUpdate: Restrict',
    );
    expect(model('PayrollExpenseCategory')).toContain(
      'fields: [groupId, organizationId], references: [id, organizationId], onDelete: Cascade, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'ON "ExpenseLabel"("id", "groupId", "organizationId")',
    );
    expect(sql).toContain('ON "ExpenseGroup"("id", "organizationId")');
    expect(sql).toContain(
      'FOREIGN KEY ("labelId", "groupId", "organizationId") REFERENCES "ExpenseLabel"("id", "groupId", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("groupId", "organizationId") REFERENCES "ExpenseGroup"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT',
    );
  });

  it.each([
    ['organization', 'organizationId', 'id', 'Organization'],
    [
      'label',
      'labelId, groupId, organizationId',
      'id, groupId, organizationId',
      'ExpenseLabel',
    ],
    ['group', 'groupId, organizationId', 'id, organizationId', 'ExpenseGroup'],
  ])(
    'cascades deletion of %s only to the association, without rekeying',
    (name, fields, references, parent) => {
      const constraint = `PayrollExpenseCategory_${name}_fkey`;
      expect(model('PayrollExpenseCategory')).toContain(
        `fields: [${fields}], references: [${references}], onDelete: Cascade, onUpdate: Restrict, map: "${constraint}"`,
      );
      const columns = (list: string) =>
        list
          .split(', ')
          .map((s) => `"${s}"`)
          .join(', ');
      expect(sql).toContain(
        `ALTER TABLE "PayrollExpenseCategory" ADD CONSTRAINT "${constraint}" FOREIGN KEY (${columns(fields)}) REFERENCES "${parent}"(${columns(references)}) ON DELETE CASCADE ON UPDATE RESTRICT;`,
      );
    },
  );

  it('introduces no foreign key from a parent or financial record to the association', () => {
    const foreignKeys = sql
      .split(';')
      .filter((statement) => /\bFOREIGN KEY\b/i.test(statement));
    expect(foreignKeys).toHaveLength(3);
    for (const statement of foreignKeys) {
      expect(statement.trim()).toMatch(
        /^ALTER TABLE "PayrollExpenseCategory" ADD CONSTRAINT/,
      );
      expect(statement).not.toMatch(/REFERENCES "PayrollExpenseCategory"/);
    }
  });

  it('leaves existing tenants and taxonomy untouched, without name inference', () => {
    expect(sql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+"(?:Organization|ExpenseLabel|ExpenseGroup|PayrollExpenseCategory)"/i,
    );
    expect(sql).not.toMatch(/\b(?:Nómina|Sueldos)\b/i);
    expect(model('PayrollExpenseCategory')).not.toMatch(/\bname\b/);
  });
});
