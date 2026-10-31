import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261031120000_whatsapp_contact_jid/migration.sql',
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

describe('whatsapp contact JID declarations (not executed SQL)', () => {
  it('stores the raw provider chat id beside the reduced contact key', () => {
    const conversation = modelBody('WhatsAppConversation');

    expect(conversation).toMatch(/contactJid\s+String\?/);
    expect(conversation).toMatch(/contactPhone\s+String/);
  });

  it('keeps the existing per-connection contact uniqueness', () => {
    const conversation = modelBody('WhatsAppConversation');

    expect(conversation).toContain('@@unique([connectionId, contactPhone])');
    expect(conversation).toContain('@@index([organizationId, state])');
  });

  it('adds the column without a destructive or required change', () => {
    expect(sql).toContain(
      `ALTER TABLE "WhatsAppConversation" ADD COLUMN "contactJid" TEXT;`,
    );
    expect(sql).not.toMatch(/\bNOT NULL\b/);
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/\bUPDATE\b/);
  });
});
