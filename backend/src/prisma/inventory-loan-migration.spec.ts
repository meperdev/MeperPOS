import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009040000_inventory_loan_foundation/migration.sql',
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

const operationMigrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009050000_inventory_loan_create_operations/migration.sql',
);
const operationSql = existsSync(operationMigrationPath)
  ? readFileSync(operationMigrationPath, 'utf8')
  : '';
const lifecycleMigrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009060000_inventory_loan_lifecycle_vocabulary/migration.sql',
);
const lifecycleSql = existsSync(lifecycleMigrationPath)
  ? readFileSync(lifecycleMigrationPath, 'utf8')
  : '';
const movementMigrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009070000_inventory_loan_movement_linkage/migration.sql',
);
const movementSql = existsSync(movementMigrationPath)
  ? readFileSync(movementMigrationPath, 'utf8')
  : '';
const movementFunction = (name: string) =>
  movementSql
    .split(`CREATE FUNCTION "${name}"() RETURNS trigger AS $$`)[1]
    ?.split('$$ LANGUAGE plpgsql;')[0] ?? '';
const modelBody = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';

describe('inventory loan movement declarations (not executed SQL)', () => {
  const insert = movementFunction('validate_inventory_loan_movement_insert');
  const mutation = movementFunction('protect_inventory_loan_movement');

  it('adds nullable unique restrictive per-event linkage and distinct enum values', () => {
    expect(modelBody('InventoryMovement')).toMatch(
      /inventoryLoanEventId\s+String\?\s+@unique/,
    );
    expect(modelBody('InventoryMovement')).toContain(
      'fields: [inventoryLoanEventId], references: [id], onDelete: Restrict, onUpdate: Restrict',
    );
    expect(modelBody('InventoryLoanEvent')).toMatch(
      /movement\s+InventoryMovement\?/,
    );
    expect(movementSql).toContain('ADD COLUMN "inventoryLoanEventId" TEXT');
    expect(movementSql).toContain(
      'CREATE UNIQUE INDEX "InventoryMovement_inventoryLoanEventId_key" ON "InventoryMovement"("inventoryLoanEventId")',
    );
    expect(movementSql).toContain(
      'ADD CONSTRAINT "InventoryMovement_inventoryLoanEventId_fkey" FOREIGN KEY ("inventoryLoanEventId") REFERENCES "InventoryLoanEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    for (const type of ['LOAN_DELIVERY', 'LOAN_RETURN']) {
      expect(schema.split('enum MovementType {')[1].split('}')[0]).toContain(
        type,
      );
      expect(movementSql).toContain(
        `ALTER TYPE "MovementType" ADD VALUE '${type}'`,
      );
    }
    expect(movementSql).not.toMatch(
      /'LOAN_(?:DELIVERY|RETURN)'::"?MovementType/,
    );
  });

  it('requires typed links and validates signed snapshots without touching legacy rows', () => {
    expect(insert).toContain(
      `IF NEW."type"::text NOT IN ('LOAN_DELIVERY', 'LOAN_RETURN') THEN`,
    );
    expect(insert).toMatch(
      /IF NEW\."inventoryLoanEventId" IS NOT NULL THEN\s+RAISE EXCEPTION/,
    );
    expect(insert).toContain(
      'NEW."inventoryLoanEventId" IS NULL OR NEW."saleId" IS NOT NULL OR NEW."userId" IS NULL',
    );
    expect(insert).toContain('NEW."previousStock" < 0 OR NEW."newStock" < 0');
    expect(insert).toContain(
      'NEW."newStock"::bigint - NEW."previousStock"::bigint <> NEW."quantity"::bigint',
    );
    expect(insert).toContain('NEW."quantity"::bigint = -e."quantity"::bigint');
    expect(insert).toContain('NEW."quantity"::bigint = e."quantity"::bigint');
    expect(insert).not.toMatch(/p\."(?:active|stock)"|UPDATE|DELETE/);
    expect(movementSql).not.toMatch(
      /UPDATE "|DELETE FROM|(?:ALTER|CREATE) TABLE "(?:Sale|Payment|InventoryLoanEvent|InventoryLoanOperation)"/,
    );
  });

  it('correlates item, loan, product, tenant, actor and completed operation', () => {
    for (const predicate of [
      'i."id" = e."itemId"',
      'i."loanId" = e."loanId"',
      'i."organizationId" = e."organizationId"',
      'l."id" = e."loanId"',
      'l."organizationId" = e."organizationId"',
      'p."id" = i."productId"',
      'p."organizationId" = e."organizationId"',
      'o."id" = e."operationId"',
      'o."loanId" = e."loanId"',
      'o."organizationId" = e."organizationId"',
      'o."actorId" = e."createdById"',
      'e."id" = NEW."inventoryLoanEventId"',
      'e."organizationId" = NEW."organizationId"',
      'i."productId" = NEW."productId"',
      'e."createdById" = NEW."userId"',
      'e."itemId" IS NOT NULL',
      'e."quantity" > 0',
      `e."type"::text = 'DELIVERED' AND o."type"::text = 'DELIVER'`,
      `e."type"::text = 'RETURNED' AND o."type"::text = 'RETURN'`,
    ])
      expect(insert).toContain(predicate);
    expect(insert).toMatch(/IF NOT EXISTS \(\s+SELECT 1/);
    expect(insert).toMatch(
      /\) THEN\s+RAISE EXCEPTION 'Inventory loan movement correlation/,
    );
    expect(movementSql).toContain(
      'BEFORE INSERT ON "InventoryMovement"\nFOR EACH ROW EXECUTE FUNCTION "validate_inventory_loan_movement_insert"()',
    );
  });

  it('blocks old or acquired loan evidence on every update and preserves ordinary mutations', () => {
    expect(mutation).toMatch(
      /IF TG_OP = 'DELETE' THEN[\s\S]*RETURN OLD;\s+END IF;/,
    );
    expect(
      mutation.match(/OLD\."inventoryLoanEventId" IS NOT NULL/g),
    ).toHaveLength(2);
    expect(
      mutation.match(
        /OLD\."type"::text IN \('LOAN_DELIVERY', 'LOAN_RETURN'\)/g,
      ),
    ).toHaveLength(2);
    expect(mutation).toContain('NEW."inventoryLoanEventId" IS NOT NULL');
    expect(mutation).toContain(
      `NEW."type"::text IN ('LOAN_DELIVERY', 'LOAN_RETURN')`,
    );
    expect(mutation).toMatch(
      /RAISE EXCEPTION 'Inventory loan movements are immutable';\s+END IF;\s+RETURN NEW;/,
    );
    expect(mutation).not.toContain('IS DISTINCT FROM');
    expect(movementSql).toContain(
      'BEFORE UPDATE OR DELETE ON "InventoryMovement"\nFOR EACH ROW EXECUTE FUNCTION "protect_inventory_loan_movement"()',
    );
  });
});

describe('inventory loan lifecycle vocabulary declarations only', () => {
  it.each([
    ['InventoryLoanStatus', ['CLOSED']],
    ['InventoryLoanEventType', ['CLOSED']],
    ['InventoryLoanOperationType', ['DELIVER', 'RETURN', 'CANCEL', 'CLOSE']],
  ] as const)(
    'extends %s without replacing existing enum values',
    (name, values) => {
      const body = schema.split(`enum ${name} {`)[1]?.split('}')[0] ?? '';
      for (const value of values) {
        expect(body).toMatch(new RegExp(`\\b${value}\\b`));
        expect(lifecycleSql).toContain(
          `ALTER TYPE "${name}" ADD VALUE '${value}'`,
        );
      }
    },
  );

  it('extends the actual shape constraint with a header-only CLOSED branch', () => {
    expect(lifecycleSql).toContain(
      'DROP CONSTRAINT "InventoryLoanEvent_shape"',
    );
    expect(lifecycleSql).toContain(
      'ADD CONSTRAINT "InventoryLoanEvent_shape" CHECK',
    );
    expect(lifecycleSql).toContain(
      `"type"::text IN ('CREATED', 'CANCELLED', 'CLOSED') AND "itemId" IS NULL AND "quantity" IS NULL`,
    );
    expect(lifecycleSql).toContain(
      `"type"::text IN ('DELIVERED', 'RETURNED', 'CANCELLED') AND`,
    );
    expect(lifecycleSql).toContain(
      '"itemId" IS NOT NULL AND "quantity" IS NOT NULL AND "quantity" > 0',
    );
    // Text comparison avoids using a newly added enum literal before commit.
    expect(lifecycleSql).not.toMatch(
      /UPDATE|DELETE|INSERT|CREATE TABLE|DROP TYPE|TRIGGER|FOREIGN KEY|operationId/,
    );
    expect(lifecycleSql.match(/ALTER TABLE/g)).toHaveLength(1);
  });
});

// Declaration checks only: no PostgreSQL execution, rollback or race proof.
describe('inventory loan migration declarations', () => {
  it.each(['InventoryLoan', 'InventoryLoanItem', 'InventoryLoanEvent'])(
    'declares additive %s persistence in both artifacts',
    (model) => {
      expect(schema).toContain(`model ${model} {`);
      expect(sql).toContain(`CREATE TABLE "${model}"`);
    },
  );

  it('binds counterparties and employee membership to the loan tenant', () => {
    expect(sql).toContain(
      'num_nonnulls("customerId", "supplierId", "employeeId") = 1',
    );
    for (const [field, target, key] of [
      ['customerId', 'Customer', 'id'],
      ['supplierId', 'Supplier', 'id'],
      ['employeeId', 'OrganizationUser', 'userId'],
    ]) {
      expect(sql).toContain(
        `FOREIGN KEY ("${field}", "organizationId") REFERENCES "${target}"("${key}", "organizationId")`,
      );
    }
    expect(sql).not.toContain('MATCH FULL');
    expect(schema).toContain('references: [userId, organizationId]');
  });

  it('binds items to scoped loans/products and events to the same item AND loan', () => {
    expect(sql).toContain(
      'FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId")',
    );
    expect(
      sql.match(
        /FOREIGN KEY \("loanId", "organizationId"\) REFERENCES "InventoryLoan"/g,
      ),
    ).toHaveLength(2);
    expect(sql).toContain(
      'FOREIGN KEY ("itemId", "loanId", "organizationId") REFERENCES "InventoryLoanItem"("id", "loanId", "organizationId")',
    );
    const item = schema.split('model InventoryLoanItem {')[1].split('\n}')[0];
    const event = schema.split('model InventoryLoanEvent {')[1].split('\n}')[0];
    expect(item).toContain('@@unique([id, loanId, organizationId])');
    expect(event).toContain('references: [id, loanId, organizationId]');
    expect(event).toContain('fields: [itemId, loanId, organizationId]');
  });

  it('declares integer bounds and nullable header versus positive item event shapes', () => {
    for (const check of [
      '"quantity" > 0',
      '"deliveredQuantity" >= 0',
      '"returnedQuantity" >= 0',
      '"cancelledQuantity" >= 0',
      '"returnedQuantity" <= "deliveredQuantity"',
      '"deliveredQuantity" <= "quantity" - "cancelledQuantity"',
      '"version" >= 0',
      '"itemId" IS NULL AND "quantity" IS NULL',
      '"itemId" IS NOT NULL AND "quantity" IS NOT NULL AND "quantity" > 0',
      "\"type\" IN ('CREATED', 'CANCELLED')",
      "\"type\" IN ('DELIVERED', 'RETURNED', 'CANCELLED')",
    ])
      expect(sql).toContain(check);
    expect(sql).toContain("'CREATED', 'DELIVERED', 'RETURNED', 'CANCELLED'");
    expect(sql).toContain(
      "CREATE TYPE \"InventoryLoanStatus\" AS ENUM ('OPEN', 'CANCELLED')",
    );
    expect(sql).not.toContain('requestKey');
    expect(sql).not.toContain('reservedRemaining');
  });

  it('protects append-only events and immutable loan/item identity without money DDL', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "InventoryLoanEvent"');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "InventoryLoan"');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "InventoryLoanItem"');
    for (const field of [
      'id',
      'organizationId',
      'customerId',
      'supplierId',
      'employeeId',
      'createdById',
      'createdAt',
      'productId',
      'loanId',
      'quantity',
    ])
      expect(sql).toContain(`OLD."${field}"`);
    expect(sql).toContain("TG_OP = 'DELETE'");
    for (const field of [
      'deliveredQuantity',
      'returnedQuantity',
      'cancelledQuantity',
    ])
      expect(sql).toContain(`NEW."${field}" < OLD."${field}"`);
    expect(sql).not.toMatch(
      /(?:ALTER|CREATE) TABLE "(?:MoneyLoan|Sale|Payment)"/,
    );
  });
});

describe('inventory loan operation declarations (not executed DB behavior)', () => {
  it('declares completed CREATE-only storage with required JSON and timestamp', () => {
    const operation = modelBody('InventoryLoanOperation');
    expect(operation).not.toBe('');
    expect(operationSql).toContain('CREATE TABLE "InventoryLoanOperation"');
    expect(schema).toMatch(/enum InventoryLoanOperationType \{\s+CREATE\b/);
    expect(operationSql).toContain(
      'CREATE TYPE "InventoryLoanOperationType" AS ENUM (\'CREATE\')',
    );
    for (const field of [
      'id',
      'organizationId',
      'loanId',
      'actorId',
      'requestKey',
    ]) {
      expect(operation).toMatch(new RegExp(`\\b${field}\\s+String\\s`));
      expect(operationSql).toContain(`"${field}" TEXT NOT NULL`);
    }
    expect(operation).toMatch(/type\s+InventoryLoanOperationType\s/);
    expect(operationSql).toContain(
      '"type" "InventoryLoanOperationType" NOT NULL',
    );
    for (const field of ['requestPayload', 'resultSnapshot']) {
      expect(operation).toMatch(new RegExp(`\\b${field}\\s+Json\\s`));
      expect(operationSql).toContain(`"${field}" JSONB NOT NULL`);
      expect(operationSql).toContain(`jsonb_typeof("${field}") = 'object'`);
      expect(operationSql).toContain(`"${field}" <> '{}'::jsonb`);
    }
    expect(operation).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(operationSql).toContain(
      '"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(operationSql).not.toMatch(
      /PENDING|ON CONFLICT|UPDATE "InventoryLoan/,
    );
  });

  it('declares tenant-wide keys, independent of actor and loan, with bounded normalized text', () => {
    const operation = modelBody('InventoryLoanOperation');
    expect(operation).toContain('@@unique([organizationId, requestKey])');
    expect(operationSql).toContain(
      'CREATE UNIQUE INDEX "InventoryLoanOperation_organizationId_requestKey_key" ON "InventoryLoanOperation"("organizationId", "requestKey")',
    );
    expect(operation).not.toMatch(
      /@@unique\(\[[^\]]*(?:actorId|loanId)[^\]]*requestKey/,
    );
    expect(operationSql).toContain(
      'char_length("requestKey") BETWEEN 1 AND 100',
    );
    expect(operationSql).toContain('"requestKey" = btrim("requestKey")');
  });

  it('binds operation loan and authenticated membership to the same tenant', () => {
    const operation = modelBody('InventoryLoanOperation');
    for (const [fields, target, references] of [
      ['loanId, organizationId', 'InventoryLoan', 'id, organizationId'],
      ['actorId, organizationId', 'OrganizationUser', 'userId, organizationId'],
    ]) {
      expect(operation).toContain(
        `fields: [${fields}], references: [${references}]`,
      );
      const quoted = (list: string) =>
        list
          .split(', ')
          .map((s) => `"${s}"`)
          .join(', ');
      expect(operationSql).toContain(
        `FOREIGN KEY (${quoted(fields)}) REFERENCES "${target}"(${quoted(references)}) ON DELETE RESTRICT ON UPDATE RESTRICT`,
      );
    }
    expect(modelBody('OrganizationUser')).toContain(
      'inventoryLoanOperations InventoryLoanOperation[]',
    );
    expect(modelBody('InventoryLoan')).toContain(
      'operations     InventoryLoanOperation[]',
    );
  });

  it('adds nullable many-event correlation bound to loan, tenant AND event actor', () => {
    const event = modelBody('InventoryLoanEvent');
    const operation = modelBody('InventoryLoanOperation');
    expect(operationSql).toContain(
      'ALTER TABLE "InventoryLoanEvent" ADD COLUMN "operationId" TEXT',
    );
    expect(event).toMatch(/operationId\s+String\?/);
    expect(event).toContain(
      'fields: [operationId, loanId, organizationId, createdById], references: [id, loanId, organizationId, actorId]',
    );
    expect(operationSql).toContain(
      'FOREIGN KEY ("operationId", "loanId", "organizationId", "createdById") REFERENCES "InventoryLoanOperation"("id", "loanId", "organizationId", "actorId") MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(operation).toContain(
      '@@unique([id, loanId, organizationId, actorId], map: "InventoryLoanOperation_event_target_key")',
    );
    expect(operationSql).toContain(
      'CREATE UNIQUE INDEX "InventoryLoanOperation_event_target_key" ON "InventoryLoanOperation"("id", "loanId", "organizationId", "actorId")',
    );
    expect(operation).toContain('events         InventoryLoanEvent[]');
    expect(event).not.toMatch(
      /operationId[^\n]*@unique|@@unique\([^\n]*operationId/,
    );
    expect(operationSql).not.toMatch(
      /CREATE UNIQUE INDEX[^\n]*ON "InventoryLoanEvent"/,
    );
    // Existing required components prevent MATCH SIMPLE from skipping a linked event.
    for (const field of ['loanId', 'organizationId', 'createdById']) {
      expect(event).toMatch(new RegExp(`\\b${field}\\s+String\\s`));
      expect(sql).toContain(`"${field}" TEXT NOT NULL`);
    }
    expect(operationSql).not.toContain('MATCH FULL');
  });

  it('unconditionally rejects operation updates/deletes without replacing event protection', () => {
    expect(operationSql).toMatch(
      /CREATE FUNCTION "reject_inventory_loan_operation_mutation"\(\) RETURNS trigger AS \$\$\s+BEGIN\s+RAISE EXCEPTION 'Inventory loan operations are immutable';\s+END;\s+\$\$ LANGUAGE plpgsql;/,
    );
    expect(operationSql).toContain(
      'BEFORE UPDATE OR DELETE ON "InventoryLoanOperation"\nFOR EACH ROW EXECUTE FUNCTION "reject_inventory_loan_operation_mutation"()',
    );
    expect(operationSql).not.toMatch(
      /DROP|TRUNCATE|DISABLE TRIGGER|CREATE TABLE "InventoryLoanEvent"/,
    );
    expect(operationSql).not.toMatch(
      /(?:ALTER|CREATE) (?:TABLE|TYPE) "(?:MoneyLoan|MoneyLoanEvent|Sale|Payment)/,
    );
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "InventoryLoanEvent"');
  });
});
