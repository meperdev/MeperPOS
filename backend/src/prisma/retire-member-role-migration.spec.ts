import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261127120000_retire_member_role/migration.sql',
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

describe('retire MEMBER role declarations (not executed SQL)', () => {
  it('defaults new memberships to CASHIER instead of MEMBER', () => {
    const membership = modelBody('OrganizationUser');

    expect(membership).toMatch(/role\s+OrgRole\s+@default\(CASHIER\)/);
    expect(membership).not.toContain('@default(MEMBER)');
  });

  it('rewrites every existing MEMBER membership to CASHIER', () => {
    expect(sql).toContain(
      `UPDATE "OrganizationUser" SET "role" = 'CASHIER' WHERE "role" = 'MEMBER';`,
    );
  });

  it('moves the column default to CASHIER', () => {
    expect(sql).toContain(
      `ALTER TABLE "OrganizationUser" ALTER COLUMN "role" SET DEFAULT 'CASHIER';`,
    );
  });

  it('locks the table with the default change before rewriting rows', () => {
    // ALTER TABLE takes ACCESS EXCLUSIVE and waits for in-flight inserts, so
    // the UPDATE that follows sees every committed row: a membership inserted
    // with the old default while the migration starts cannot escape it.
    const alterAt = sql.indexOf('ALTER TABLE "OrganizationUser"');
    const updateAt = sql.indexOf('UPDATE "OrganizationUser"');

    expect(alterAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(alterAt);
    expect(sql).toMatch(/BEGIN;[\s\S]*ALTER TABLE[\s\S]*UPDATE[\s\S]*COMMIT;/);
  });

  it('keeps the enum value and touches no other table', () => {
    // Dropping MEMBER from the enum needs a type recreation (phase 4); audit
    // rows keep the free-text role they were written with.
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/\bTYPE\b/);
    expect(sql.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(sql).not.toMatch(/"AuditLog"/);
  });
});
