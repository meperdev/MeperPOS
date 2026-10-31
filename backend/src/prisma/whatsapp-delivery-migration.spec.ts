import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261029160000_whatsapp_delivery/migration.sql',
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

describe('whatsapp daily report delivery declarations (not executed SQL)', () => {
  it('records one delivery attempt per connection, kind and calendar day', () => {
    const delivery = modelBody('WhatsAppDelivery');

    expect(delivery).toMatch(/connectionId\s+String/);
    expect(delivery).toMatch(/kind\s+WhatsAppDeliveryKind/);
    expect(delivery).toMatch(/reportDate\s+DateTime\s+@db\.Date/);
    expect(delivery).toMatch(
      /status\s+WhatsAppDeliveryStatus\s+@default\(PENDING\)/,
    );
    expect(delivery).toMatch(/failureReason\s+String\?/);
    expect(delivery).toMatch(/providerMessageId\s+String\?/);
    expect(delivery).toMatch(/attempts\s+Int\s+@default\(0\)/);
    expect(delivery).toMatch(/sentAt\s+DateTime\?/);
    expect(delivery).toContain('createdAt');
    expect(delivery).toContain('updatedAt');
    expect(delivery).toContain('@@index([connectionId, reportDate])');
  });

  it('cascades delivery history with the connection that produced it', () => {
    const delivery = modelBody('WhatsAppDelivery');

    expect(delivery).toContain(
      'connection WhatsAppConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)',
    );
    expect(modelBody('WhatsAppConnection')).toContain(
      'deliveries      WhatsAppDelivery[]',
    );
  });

  it('does not hide the once-per-day rule behind a composite unique', () => {
    // A plain @@unique([connectionId, kind, reportDate]) would also reject a
    // second ON_DEMAND report on the same day, so the scheduled case is the only
    // one the schema-level constraint may cover.
    expect(modelBody('WhatsAppDelivery')).not.toContain('@@unique');
  });

  it('fixes the delivery vocabulary to the two kinds and three states', () => {
    expect(enumBody('WhatsAppDeliveryKind').trim().split(/\s+/)).toEqual([
      'SCHEDULED',
      'ON_DEMAND',
    ]);
    expect(enumBody('WhatsAppDeliveryStatus').trim().split(/\s+/)).toEqual([
      'PENDING',
      'SENT',
      'FAILED',
    ]);
  });

  it('creates the table with the same cascade link', () => {
    expect(sql).toContain('CREATE TABLE "WhatsAppDelivery"');
    expect(sql).toContain('"reportDate" DATE NOT NULL');
    expect(sql).toContain('"attempts" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain(
      'ALTER TABLE "WhatsAppDelivery" ADD CONSTRAINT "WhatsAppDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'CREATE INDEX "WhatsAppDelivery_connectionId_reportDate_idx" ON "WhatsAppDelivery"("connectionId", "reportDate")',
    );
  });

  it('enforces the scheduled rule as a partial unique index', () => {
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "WhatsAppDelivery_scheduled_once_per_day_key" ON "WhatsAppDelivery"("connectionId", "kind", "reportDate") WHERE "kind" = 'SCHEDULED'`,
    );
    // The predicate is what keeps on-demand repeats legal.
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*\("connectionId", "kind", "reportDate"\)(?! WHERE)/,
    );
  });
});
