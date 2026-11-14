import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261029130000_whatsapp_multi_session/migration.sql',
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

describe('whatsapp multi-session declarations (not executed SQL)', () => {
  it('declares a provider connection per channel with a session name', () => {
    const connection = modelBody('WhatsAppConnection');

    expect(connection).toMatch(/provider\s+String\s+@default\("WAHA"\)/);
    expect(connection).toMatch(/sessionName\s+String\s+@unique/);
    expect(connection).toMatch(/channel\s+WhatsAppChannel/);
    expect(connection).toMatch(/organizationId\s+String\?/);
    expect(connection).toMatch(
      /status\s+WhatsAppSessionStatus\s+@default\(STOPPED\)/,
    );
    expect(connection).toContain('statusUpdatedAt DateTime?');
    expect(connection).toContain('accountId       String?');
    expect(connection).toContain('@@unique([channel, organizationId])');
    expect(connection).toContain('fields: [organizationId], references: [id]');
  });

  it('declares durable deduplication keyed by connection and provider event', () => {
    const processed = modelBody('WhatsAppProcessedEvent');

    expect(processed).toMatch(/connectionId\s+String/);
    expect(processed).toMatch(/providerEventId\s+String/);
    expect(processed).toMatch(/eventType\s+String/);
    expect(processed).toContain('@@unique([connectionId, providerEventId])');
    expect(processed).toContain('onDelete: Cascade');
  });

  it('keeps the channel enum to the two confirmed channels', () => {
    const channel = enumBody('WhatsAppChannel');

    expect(channel.trim().split(/\s+/)).toEqual(['COMMERCIAL', 'INTELLIGENCE']);
  });

  it('mirrors every provider session status, including the passkey states', () => {
    expect(enumBody('WhatsAppSessionStatus').trim().split(/\s+/)).toEqual([
      'STOPPED',
      'STARTING',
      'SCAN_QR_CODE',
      'PASSKEY_REQUIRED',
      'PASSKEY_CONFIRMATION_REQUIRED',
      'WORKING',
      'FAILED',
    ]);
  });

  it('creates both tables with restrictive uniqueness and cascade links', () => {
    expect(sql).toContain(
      `CREATE TYPE "WhatsAppChannel" AS ENUM ('COMMERCIAL', 'INTELLIGENCE')`,
    );
    expect(sql).toContain('CREATE TABLE "WhatsAppConnection"');
    expect(sql).toContain('CREATE TABLE "WhatsAppProcessedEvent"');
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppConnection_sessionName_key" ON "WhatsAppConnection"("sessionName")`,
    );
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppConnection_channel_organizationId_key" ON "WhatsAppConnection"("channel", "organizationId")`,
    );
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppProcessedEvent_connectionId_providerEventId_key" ON "WhatsAppProcessedEvent"("connectionId", "providerEventId")`,
    );
    expect(sql).toContain(`ON DELETE CASCADE ON UPDATE CASCADE`);
  });

  it('allows exactly one central intelligence connection and one session per organization', () => {
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppConnection_central_intelligence_key" ON "WhatsAppConnection"("channel") WHERE "channel" = 'INTELLIGENCE'`,
    );
    expect(modelBody('Organization')).toContain('whatsAppConnections');
  });
});
