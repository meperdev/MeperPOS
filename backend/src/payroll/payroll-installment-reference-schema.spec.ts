import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migrationsDir = resolve(__dirname, '../../prisma/migrations');
const migrationName = '20261009280000_payroll_installment_reference';
const sqlPath = resolve(migrationsDir, migrationName, 'migration.sql');
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';
const reference = () => model('PayrollInstallmentReference');

// Structural checks only: no database connection, no migration execution.
// A reference records that a replacement payment of a completed payment counts
// one already-paid installment as its own paid cash (L327, L338). It is
// evidence of shared cash, never a second cash outflow.
describe('payroll installment reference storage foundation', () => {
  it('adds one additive table for referenced installments', () => {
    expect(existsSync(sqlPath)).toBe(true);
    expect(reference()).not.toBe('');
    expect(sql).toContain('CREATE TABLE "PayrollInstallmentReference"');
    // Additive only: no existing payroll, expense or migration row is rewritten.
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    // Documenting that TRUNCATE is not guarded is allowed; running it is not.
    expect(sql).not.toMatch(/TRUNCATE\s+"/i);
  });

  it('stores the tenant identity of the target payment and the source installment', () => {
    for (const field of [
      'organizationId',
      'employeeId',
      'targetObligationId',
      'sourceObligationId',
      'sourceInstallmentId',
    ]) {
      expect(reference()).toMatch(new RegExp(`^\\s*${field}\\s+String`, 'm'));
      expect(sql).toContain(`"${field}" TEXT NOT NULL`);
    }
  });

  it('pins the target obligation through a restricted composite reference', () => {
    expect(model('PayrollObligation')).toContain(
      '@@unique([id, organizationId, employeeId])',
    );
    expect(reference()).toContain(
      'fields: [targetObligationId, organizationId, employeeId], references: [id, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("targetObligationId", "organizationId", "employeeId") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it('pins the source installment to its own obligation, tenant and employee', () => {
    // The identity target already exists on the installment table, so the
    // reference cannot be re-pointed at another payment's installment.
    expect(model('PayrollInstallment')).toContain(
      '@@unique([id, obligationId, organizationId, employeeId], map: "PayrollInstallment_allocation_target_key")',
    );
    expect(reference()).toContain(
      'fields: [sourceInstallmentId, sourceObligationId, organizationId, employeeId], references: [id, obligationId, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("sourceInstallmentId", "sourceObligationId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    // No reindexing of an existing payroll table is required by this migration.
    expect(sql).not.toMatch(/ON "PayrollInstallment"/);
    expect(sql).not.toMatch(/ON "PayrollObligation"/);
  });

  it('refuses cascades so referenced cash identity cannot be lost', () => {
    const relations = reference()
      .split('\n')
      .filter((line) => line.includes('@relation('))
      .join('\n');
    expect(relations).not.toMatch(/onDelete:\s*Cascade/);
    expect(relations).not.toMatch(/onUpdate:\s*(?:Cascade|SetNull)/);
    expect(relations.match(/onDelete:\s*Restrict/g)).toHaveLength(2);
    expect(relations.match(/onUpdate:\s*Restrict/g)).toHaveLength(2);
    expect(sql).not.toMatch(/ON DELETE (?:CASCADE|SET NULL)/i);
  });

  it('counts each source installment at most once per target payment', () => {
    expect(reference()).toContain(
      '@@unique([targetObligationId, sourceInstallmentId], map: "PayrollInstallmentReference_target_source_key")',
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "PayrollInstallmentReference_target_source_key"\s+ON "PayrollInstallmentReference"\("targetObligationId", "sourceInstallmentId"\)/,
    );
    // The key is scoped by the composite foreign keys, so it also carries the
    // tenant; it is never a global uniqueness on the source installment alone.
    expect(reference()).not.toMatch(/@@unique\(\[sourceInstallmentId\], /);
  });

  it('indexes the already-referenced lookup a writer needs', () => {
    expect(reference()).toContain(
      '@@index([sourceInstallmentId, organizationId, employeeId], map: "PayrollInstallmentReference_source_idx")',
    );
    expect(sql).toContain(
      'CREATE INDEX "PayrollInstallmentReference_source_idx"',
    );
  });

  it('stores an exact amount snapshot of the referenced cash', () => {
    expect(reference()).toMatch(/^\s*amount\s+Decimal\s+@db\.Decimal$/m);
    expect(sql).toContain('"amount" NUMERIC NOT NULL');
    expect(sql).toContain('CHECK ("amount" > 0');
    expect(sql).toContain(`"amount" < 'Infinity'::numeric`);
    expect(sql).toContain('scale("amount") <= 2');
    expect(reference()).toMatch(
      /^\s*createdAt\s+DateTime\s+@default\(now\(\)\)/m,
    );
    expect(sql).toContain(
      '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  it('never stores a second cash outflow for referenced money', () => {
    // Referenced cash already exists as the source outflow: this table records
    // the reference, so it must not carry an outflow of its own.
    expect(reference()).not.toMatch(/^\s*\w*[Oo]utflow\w*\s+String/m);
    expect(reference()).not.toMatch(/outflowId/);
    expect(sql).not.toMatch(/"\w*[Oo]utflow\w*"/);
    expect(sql).not.toMatch(/PayrollCashOutflow/);
  });

  it('rejects updates and deletes of reference facts', () => {
    expect(reference()).not.toMatch(/updatedAt/);
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON "PayrollInstallmentReference"[\s\S]*FOR EACH ROW EXECUTE FUNCTION/,
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'Payroll installment references cannot be changed or deleted'",
    );
  });

  it('follows the newest applied migration and defines the table only once', () => {
    const dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const prerequisite = dirs.indexOf(
      '20261009270000_payroll_installment_sequence',
    );
    const referenceMigration = dirs.indexOf(migrationName);
    expect(prerequisite).toBeGreaterThanOrEqual(0);
    expect(referenceMigration).toBeGreaterThan(prerequisite);
    const declared = dirs
      .filter((dir) =>
        readFileSync(
          resolve(migrationsDir, dir, 'migration.sql'),
          'utf8',
        ).includes('PayrollInstallmentReference'),
      )
      .map((dir) => dir);
    expect(declared).toEqual([migrationName]);
  });
});
