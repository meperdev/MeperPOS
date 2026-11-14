import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261029140000_whatsapp_commercial_ingestion/migration.sql',
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

describe('whatsapp commercial ingestion declarations (not executed SQL)', () => {
  it('keeps one conversation per contact per connection', () => {
    const conversation = modelBody('WhatsAppConversation');

    expect(conversation).toMatch(/connectionId\s+String/);
    expect(conversation).toMatch(/contactPhone\s+String/);
    expect(conversation).toMatch(/organizationId\s+String\?/);
    expect(conversation).toContain('@@unique([connectionId, contactPhone])');
    expect(conversation).toContain('@@index([organizationId, state])');
  });

  it('stores timing facts the supervision view needs without inventing a location', () => {
    const conversation = modelBody('WhatsAppConversation');

    expect(conversation).toContain('firstInboundAt');
    expect(conversation).toContain('firstResponseAt');
    expect(conversation).toContain('lastMessageAt');
    expect(conversation).toContain('customerId');
    expect(conversation).not.toContain('locationId');
  });

  it('stores each message once, keyed by the provider message id', () => {
    const message = modelBody('WhatsAppMessage');

    expect(message).toMatch(/conversationId\s+String/);
    expect(message).toMatch(/providerMessageId\s+String/);
    expect(message).toMatch(/direction\s+WhatsAppMessageDirection/);
    expect(message).toMatch(/source\s+String/);
    expect(message).toContain('@@unique([conversationId, providerMessageId])');
    expect(message).toContain('@@index([conversationId, sentAt])');
  });

  it('registers internal contacts so they never reach the automated agent', () => {
    const contact = modelBody('WhatsAppInternalContact');

    expect(contact).toMatch(/phone\s+String/);
    expect(contact).toMatch(/organizationId\s+String/);
    expect(contact).toContain('@@unique([organizationId, phone])');
  });

  it('fixes the conversation vocabulary to the three real states', () => {
    expect(enumBody('WhatsAppConversationState').trim().split(/\s+/)).toEqual([
      'AUTOMATED',
      'HUMAN',
      'SUSPENDED',
    ]);
    expect(enumBody('WhatsAppMessageDirection').trim().split(/\s+/)).toEqual([
      'INBOUND',
      'OUTBOUND',
    ]);
    expect(enumBody('WhatsAppContactKind').trim().split(/\s+/)).toEqual([
      'CLIENT',
      'INTERNAL',
      'UNKNOWN',
    ]);
  });

  it('creates the tables with the same uniqueness and cascade links', () => {
    expect(sql).toContain('CREATE TABLE "WhatsAppConversation"');
    expect(sql).toContain('CREATE TABLE "WhatsAppMessage"');
    expect(sql).toContain('CREATE TABLE "WhatsAppInternalContact"');
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppConversation_connectionId_contactPhone_key" ON "WhatsAppConversation"("connectionId", "contactPhone")`,
    );
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppMessage_conversationId_providerMessageId_key" ON "WhatsAppMessage"("conversationId", "providerMessageId")`,
    );
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppInternalContact_organizationId_phone_key" ON "WhatsAppInternalContact"("organizationId", "phone")`,
    );
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
    expect(sql).not.toContain('"locationId"');
  });
});
