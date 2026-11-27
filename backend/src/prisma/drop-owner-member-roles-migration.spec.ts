import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261127200000_drop_owner_member_roles/migration.sql',
);
// No fallback: a missing or renamed migration must fail here, not let the
// negative assertions below pass against an empty string.
const sql = readFileSync(migrationPath, 'utf8');
const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

describe('drop OWNER and MEMBER from the role enum declarations (not executed SQL)', () => {
  it('declares exactly the three roles of S1 in the schema', () => {
    expect(schema).toMatch(
      /enum OrgRole \{\s+ADMIN\s+CASHIER\s+INVENTORY_USER\s+\}/,
    );
    expect(schema).not.toMatch(/enum OrgRole \{[^}]*\bOWNER\b/);
    expect(schema).not.toMatch(/enum OrgRole \{[^}]*\bMEMBER\b/);
  });

  it('rewrites every straggler before the type is recreated', () => {
    expect(sql).toContain(
      `UPDATE "OrganizationUser" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';`,
    );
    expect(sql).toContain(
      `UPDATE "OrganizationUser" SET "role" = 'CASHIER' WHERE "role" = 'MEMBER';`,
    );

    const lastRewrite = Math.max(
      sql.indexOf(`WHERE "role" = 'OWNER'`),
      sql.indexOf(`WHERE "role" = 'MEMBER'`),
    );
    expect(lastRewrite).toBeGreaterThan(-1);
    expect(sql.indexOf('CREATE TYPE "OrgRole"')).toBeGreaterThan(lastRewrite);
  });

  it('recreates the OrgRole type with the three roles and keeps the column default', () => {
    expect(sql).toContain(
      `CREATE TYPE "OrgRole" AS ENUM ('ADMIN', 'CASHIER', 'INVENTORY_USER');`,
    );
    expect(sql).toMatch(
      /ALTER COLUMN "role" TYPE "OrgRole" USING \("role"::text::"OrgRole"\)/,
    );
    expect(sql).toContain(
      `ALTER TABLE "OrganizationUser" ALTER COLUMN "role" SET DEFAULT 'CASHIER';`,
    );
    // The old labels cannot survive under the new type: dropping the previous
    // type is what makes the values unrepresentable at the database boundary.
    expect(sql).toMatch(/DROP TYPE "OrgRole_\w+";/);
  });

  it('drops the old default before the type change and restores it after', () => {
    const dropDefaultAt = sql.indexOf(
      `ALTER TABLE "OrganizationUser" ALTER COLUMN "role" DROP DEFAULT;`,
    );
    const typeChangeAt = sql.indexOf(
      `ALTER TABLE "OrganizationUser" ALTER COLUMN "role" TYPE "OrgRole"`,
    );
    const setDefaultAt = sql.indexOf(
      `ALTER TABLE "OrganizationUser" ALTER COLUMN "role" SET DEFAULT 'CASHIER';`,
    );

    expect(dropDefaultAt).toBeGreaterThan(-1);
    expect(typeChangeAt).toBeGreaterThan(dropDefaultAt);
    expect(setDefaultAt).toBeGreaterThan(typeChangeAt);
  });

  it('locks membership writers out for the whole transaction', () => {
    const lockAt = sql.indexOf('LOCK TABLE "OrganizationUser"');
    const firstRewriteAt = sql.indexOf(`WHERE "role" = 'OWNER'`);

    expect(lockAt).toBeGreaterThan(-1);
    expect(firstRewriteAt).toBeGreaterThan(lockAt);
    expect(sql).toMatch(/SHARE ROW EXCLUSIVE/);
    // Do not queue membership writers indefinitely while waiting for the lock.
    expect(sql).toMatch(/lock_timeout/);
    expect(sql).toMatch(/\nBEGIN;[\s\S]*COMMIT;\n$/);
  });

  it('drops and recreates the principal-site trigger around the type change', () => {
    // Postgres refuses to alter a column named by a trigger's `UPDATE OF` list,
    // so the trigger goes away for the type change and comes back identical.
    const dropAt = sql.indexOf(
      'DROP TRIGGER "OrganizationUser_principal_site" ON "OrganizationUser";',
    );
    const typeChangeAt = sql.indexOf('ALTER TYPE "OrgRole" RENAME TO');
    const recreateAt = sql.indexOf(
      'CREATE TRIGGER "OrganizationUser_principal_site"',
    );

    expect(dropAt).toBeGreaterThan(-1);
    expect(typeChangeAt).toBeGreaterThan(dropAt);
    expect(recreateAt).toBeGreaterThan(typeChangeAt);
    expect(sql).toContain(
      'AFTER INSERT OR UPDATE OF "role" ON "OrganizationUser"',
    );
    expect(sql).toContain(
      'FOR EACH ROW EXECUTE FUNCTION "grant_principal_site"();',
    );
  });

  it('leaves isPrimaryOwner and every other table alone', () => {
    expect(sql).not.toMatch(/"isPrimaryOwner"/);
    expect(sql).not.toMatch(/"MembershipLocation"/);
    expect(sql).not.toMatch(/"AuditLog"/);
    expect(sql).not.toMatch(/"Organization"/);
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/INSERT INTO/);
  });
});
