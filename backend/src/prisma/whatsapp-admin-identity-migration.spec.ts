import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261029150000_whatsapp_admin_identity/migration.sql',
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
const enumBody = (name: string) =>
  schema.split(`enum ${name} {`)[1]?.split('\n}')[0] ?? '';

describe('whatsapp administrative identity declarations (not executed SQL)', () => {
  it('binds one phone to exactly one user and one active organization context', () => {
    const identity = modelBody('WhatsAppIdentity');

    expect(identity).toMatch(/phone\s+String\s+@unique/);
    expect(identity).toMatch(/userId\s+String/);
    expect(identity).toMatch(/organizationId\s+String\?/);
    expect(identity).toMatch(
      /status\s+WhatsAppIdentityStatus\s+@default\(PENDING\)/,
    );
    expect(identity).toContain('verifiedAt');
    expect(identity).toContain('revokedAt');
    expect(identity).toContain('@@index([userId, status])');
  });

  it('never stores the linking code in clear text', () => {
    const challenge = modelBody('WhatsAppLinkChallenge');

    expect(challenge).toMatch(/codeHash\s+String\s+@unique/);
    expect(challenge).not.toMatch(/^\s+code\s+String/m);
    expect(challenge).toContain('expiresAt');
    expect(challenge).toContain('consumedAt');
  });

  it('scopes every challenge to the user and the organization chosen in the web session', () => {
    const challenge = modelBody('WhatsAppLinkChallenge');

    expect(challenge).toMatch(/userId\s+String/);
    expect(challenge).toMatch(/organizationId\s+String/);
    expect(challenge).not.toMatch(/organizationId\s+String\?/);
    expect(challenge).toContain('@@index([expiresAt])');
  });

  it('fixes the identity vocabulary to the three real states', () => {
    expect(enumBody('WhatsAppIdentityStatus').trim().split(/\s+/)).toEqual([
      'PENDING',
      'VERIFIED',
      'REVOKED',
    ]);
  });

  it('creates the tables with the same uniqueness and cascade links', () => {
    expect(sql).toContain('CREATE TABLE "WhatsAppIdentity"');
    expect(sql).toContain('CREATE TABLE "WhatsAppLinkChallenge"');
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppIdentity_phone_key" ON "WhatsAppIdentity"("phone")`,
    );
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppLinkChallenge_codeHash_key" ON "WhatsAppLinkChallenge"("codeHash")`,
    );
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
  });
});
