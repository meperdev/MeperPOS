import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261029170000_whatsapp_retention/migration.sql',
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

const modelBody = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

describe('whatsapp message retention declarations (not executed SQL)', () => {
  it('gives every connection a non-nullable retention policy', () => {
    const connection = modelBody('WhatsAppConnection');

    // Never nullable: the channel always has a policy, so the purge job reads a
    // number and never has to fall back to a configured default.
    expect(connection).toMatch(/retentionDays\s+Int\s+@default\(30\)/);
    expect(connection).not.toMatch(/retentionDays\s+Int\?/);
  });

  it('adds the column with a default so existing rows are covered', () => {
    expect(sql).toContain(
      'ALTER TABLE "WhatsAppConnection" ADD COLUMN "retentionDays" INTEGER NOT NULL DEFAULT 30',
    );
  });

  it('enforces a one-day floor without scanning the existing row', () => {
    expect(sql).toContain('CHECK ("retentionDays" >= 1) NOT VALID');
    // NOT VALID is what keeps a corrupted legacy row from blocking the deploy.
    expect(sql).toMatch(
      /ADD CONSTRAINT "WhatsAppConnection_retentionDays_check"[^;]*NOT VALID;/,
    );
  });

  it('touches nothing else', () => {
    // A retention policy is one column and one check: no new table, no dropped
    // column, no data rewrite of the message history.
    expect(sql).not.toMatch(/CREATE TABLE/);
    expect(sql).not.toMatch(/DROP /);
    expect(sql).not.toMatch(/UPDATE "WhatsAppConnection"/);
  });
});
