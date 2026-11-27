import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261127130000_collapse_owner_into_admin/migration.sql',
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const hierarchy = JSON.parse(
  readFileSync(
    resolve(__dirname, '../common/guards/role-hierarchy.table.json'),
    'utf8',
  ),
) as Record<string, string[]>;

describe('collapse OWNER into ADMIN declarations (not executed SQL)', () => {
  it('rewrites every existing OWNER membership to ADMIN', () => {
    expect(sql).toContain(
      `UPDATE "OrganizationUser" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';`,
    );
  });

  it('keeps the isPrimaryOwner flag and leaves the column alone', () => {
    // Ownership stays identified by the membership flag: the migration must
    // not copy, clear or infer it while the role changes.
    expect(sql).not.toMatch(/"isPrimaryOwner"/);
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/\bINSERT\b/);
  });

  it('keeps the OWNER enum value until phase 4', () => {
    expect(schema).toMatch(/enum OrgRole \{\s+OWNER\s+ADMIN/);
    expect(sql).not.toMatch(/\bTYPE\b/);
    expect(sql).not.toMatch(/\bDROP\b/);
  });

  it('keeps the OWNER hierarchy row so a stray OWNER still reads as ADMIN', () => {
    expect(hierarchy.OWNER).toEqual(expect.arrayContaining(['OWNER', 'ADMIN']));
  });

  it('holds membership writers out before rewriting the rows', () => {
    const lockAt = sql.indexOf('LOCK TABLE "OrganizationUser"');
    const updateAt = sql.indexOf('UPDATE "OrganizationUser"');

    expect(lockAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(lockAt);
    expect(sql).toMatch(/SHARE ROW EXCLUSIVE/);
    // Do not queue membership writers indefinitely while waiting for the lock.
    expect(sql).toMatch(/lock_timeout/);
    expect(sql).toMatch(/BEGIN;[\s\S]*UPDATE[\s\S]*COMMIT;/);
  });

  it('touches no other table and runs one rewrite', () => {
    expect(sql.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(sql).not.toMatch(/"MembershipLocation"/);
    expect(sql).not.toMatch(/"AuditLog"/);
    expect(sql).not.toMatch(/"Organization"/);
  });
});
