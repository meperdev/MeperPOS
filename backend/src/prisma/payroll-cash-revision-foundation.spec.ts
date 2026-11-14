import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const path = resolve(
  __dirname,
  '../../prisma/migrations/20261009200000_payroll_cash_revision/migration.sql',
);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
const sequencePath = resolve(
  __dirname,
  '../../prisma/migrations/20261009210000_payroll_revision_sequence/migration.sql',
);
const sequenceSql = existsSync(sequencePath)
  ? readFileSync(sequencePath, 'utf8')
  : '';
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

// Structural checks only: PostgreSQL execution and transaction semantics are deferred.
describe('unwired payroll cash revision foundation', () => {
  it('binds the installment and outflow together within the employee and tenant', () => {
    expect(model('PayrollInstallment')).toContain(
      '@@unique([id, obligationId, outflowId, organizationId, employeeId], map: "PayrollInstallment_revision_target_key")',
    );
    expect(model('PayrollCashRevision')).toContain(
      'fields: [installmentId, obligationId, outflowId, organizationId, employeeId], references: [id, obligationId, outflowId, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'ON "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("installmentId", "obligationId", "outflowId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
  });

  it('retains the obligation in the restricted installment reference', () => {
    expect(model('PayrollCashRevision')).toMatch(/obligationId\s+String/);
    expect(sql).toContain('"obligationId" TEXT NOT NULL');
    expect(model('PayrollInstallment')).toContain(
      '@@unique([id, obligationId, outflowId, organizationId, employeeId], map: "PayrollInstallment_revision_target_key")',
    );
    expect(model('PayrollCashRevision')).toContain(
      'fields: [installmentId, obligationId, outflowId, organizationId, employeeId], references: [id, obligationId, outflowId, organizationId, employeeId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'ON "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("installmentId", "obligationId", "outflowId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(model('PayrollCashRevision')).toContain(
      '@@index([installmentId, obligationId, outflowId, organizationId, employeeId], map: "PayrollCashRevision_installment_idx")',
    );
    expect(sql).toContain(
      'ON "PayrollCashRevision"("installmentId", "obligationId", "outflowId", "organizationId", "employeeId")',
    );
  });

  it('attributes the correction to an organization member and records immutable event snapshots', () => {
    const revision = model('PayrollCashRevision');
    expect(revision).toContain(
      'fields: [actorId, organizationId], references: [userId, organizationId], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(revision).toMatch(/originalDate\s+DateTime\s+@db.Date/);
    expect(revision).toMatch(/originalMethod\s+PaymentMethod/);
    expect(revision).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(sql).toContain('"originalDate" DATE NOT NULL');
    expect(sql).toContain('"originalMethod" "PaymentMethod" NOT NULL');
    expect(sql).toContain(
      '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  it('requires positive finite old and new amounts with at most two decimal places', () => {
    for (const field of ['oldAmount', 'newAmount']) {
      expect(model('PayrollCashRevision')).toMatch(
        new RegExp(`${field}\\s+Decimal\\s+@db.Decimal`),
      );
      expect(sql).toContain(`"${field}" NUMERIC NOT NULL`);
      expect(sql).toContain(`"${field}" > 0`);
      expect(sql).toContain(`"${field}" < 'Infinity'::numeric`);
      expect(sql).toContain(`scale("${field}") <= 2`);
    }
  });

  it('rejects updates and deletes of revision facts while allowing multiple revisions', () => {
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "PayrollCashRevision"/);
    expect(sql).toContain(
      "RAISE EXCEPTION 'Payroll cash revision history cannot be changed or deleted'",
    );
    expect(model('PayrollCashRevision')).not.toMatch(
      /@@unique\(\[(?:installmentId|outflowId)\]/,
    );
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "PayrollCashRevision"\("(?:installmentId|outflowId)"\)/,
    );
  });

  it('stores a positive sequence unique within each installment', () => {
    expect(model('PayrollCashRevision')).toMatch(/sequence\s+Int/);
    expect(model('PayrollCashRevision')).toContain(
      '@@unique([installmentId, sequence], map: "PayrollCashRevision_installment_sequence_key")',
    );
    expect(sequenceSql).toContain('"sequence" INTEGER NOT NULL');
    expect(sequenceSql).toContain('CHECK ("sequence" > 0)');
    expect(sequenceSql).toContain(
      'ON "PayrollCashRevision"("installmentId", "sequence")',
    );
  });

  it('preserves the committed revision migration byte for byte', () => {
    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      '4d9ea8cae8554645a48c2ad12c5cf05ce51769fc5ad5066a7ca780ed862a61d1',
    );
  });

  it('locks and rejects existing history before sequence DDL in one transaction', () => {
    expect(sequenceSql).toMatch(
      /BEGIN;[\s\S]*LOCK TABLE "PayrollCashRevision" IN ACCESS EXCLUSIVE MODE;[\s\S]*IF EXISTS \(SELECT 1 FROM "PayrollCashRevision"\) THEN[\s\S]*RAISE EXCEPTION[\s\S]*END IF;[\s\S]*ALTER TABLE "PayrollCashRevision"[\s\S]*CREATE UNIQUE INDEX[\s\S]*COMMIT;/,
    );
    expect(sequenceSql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+"PayrollCashRevision"/i,
    );
  });

  it('does not update cash, installments or allocate money in the migration', () => {
    expect(sql).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) "(?:PayrollCashOutflow|PayrollInstallment|PayrollAllocation)"/,
    );
  });
});
