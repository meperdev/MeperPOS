import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009250000_expense_label_index/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

// Structural checks only; PostgreSQL behavior requires separate proof.
describe('expense label index storage', () => {
  it('declares the composite index the schema promises', () => {
    expect(model('Expense')).toContain('@@index([organizationId, labelId])');
  });

  it('creates the schema-declared index under the Prisma default name', () => {
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      'CREATE INDEX "Expense_organizationId_labelId_idx" ON "Expense"("organizationId", "labelId")',
    );
  });

  it('creates the index on Expense over the exact schema column order', () => {
    const create = statements[0] ?? '';
    const [, table, columns] =
      /^CREATE INDEX "Expense_organizationId_labelId_idx" ON "([^"]+)"\((.+)\)$/.exec(
        create,
      ) ?? [];
    expect(table).toBe('Expense');
    expect(columns?.split(', ')).toEqual(['"organizationId"', '"labelId"']);
  });

  it('performs no other statement: no table, column, constraint or data change', () => {
    expect(
      statements.every((statement) => /^CREATE INDEX\b/.test(statement)),
    ).toBe(true);
    expect(sql).not.toMatch(
      /\b(?:CREATE\s+TABLE|CREATE\s+UNIQUE\s+INDEX|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|CONSTRAINT)|TRUNCATE|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i,
    );
    expect(sql).not.toMatch(/\b(?:SET|RESET)\s+\w+/i);
  });

  it('is additive: no index or migration of another name is touched', () => {
    const indexNames = [...sql.matchAll(/"([A-Za-z0-9_]+_idx)"/g)].map(
      (match) => match[1],
    );
    expect(indexNames).toEqual(['Expense_organizationId_labelId_idx']);
  });
});
