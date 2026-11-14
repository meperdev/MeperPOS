import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009100000_pos_loan_sale_reservations/migration.sql',
);
// Missing planned SQL is declaration input, never a module-loading failure.
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const ddl = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
const oldIntent = readFileSync(
  resolve(
    __dirname,
    '../../prisma/migrations/20261009080000_pos_loan_sale_intent/migration.sql',
  ),
  'utf8',
);
const oldQuote = readFileSync(
  resolve(
    __dirname,
    '../../prisma/migrations/20261009090000_pos_loan_sale_quote/migration.sql',
  ),
  'utf8',
);
const model = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';
const compact = (text: string) => text.replace(/\s+/g, '');
const intent = model('PosLoanSaleIntent');
const reservation = model('PosLoanSaleReservation');
const table =
  ddl.match(
    /CREATE\s+TABLE\s+"PosLoanSaleReservation"\s*\(([\s\S]*?)\);/i,
  )?.[1] ?? '';
const functions = [
  ...ddl.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"([^"]+)"\([^)]*\)\s+RETURNS\s+\w+\s+AS\s+\$\$([\s\S]*?)\$\$\s+LANGUAGE\s+plpgsql/gi,
  ),
];
const guard = (target: string, events: string) => {
  const trigger = ddl.match(
    new RegExp(
      `BEFORE\\s+${events}\\s+ON\\s+"${target}"\\s+FOR\\s+EACH\\s+ROW\\s+EXECUTE\\s+FUNCTION\\s+"([^"]+)"\\(\\)`,
      'i',
    ),
  );
  expect(trigger).not.toBeNull();
  return functions.find((match) => match[1] === trigger?.[1])?.[2] ?? '';
};

// Declaration evidence only: no PostgreSQL execution, runtime replay, counter
// ownership, Serializable/CAS race proof or global reservedStock reconciliation.
describe('POS loan initiation and owned reservation declarations (not executed SQL)', () => {
  it('retains the existing nullable quote pair, scoped parent FK and independent guards', () => {
    expect(intent).toMatch(/quoteSnapshot\s+Json\?/);
    expect(intent).toMatch(
      /agreedCustomerTotal\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/,
    );
    expect(compact(oldQuote)).toContain(
      'CHECK(("quoteSnapshot"ISNULL)=("agreedCustomerTotal"ISNULL))',
    );
    expect(compact(oldIntent)).toContain(
      'FOREIGNKEY("loanId","organizationId","customerId")REFERENCES"MoneyLoan"("id","organizationId","customerId")ONDELETERESTRICTONUPDATERESTRICT',
    );
    expect(oldIntent).toMatch(
      /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"PosLoanSaleIntent"/i,
    );
    expect(oldQuote).toMatch(
      /BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+"PosLoanSaleIntent"/i,
    );
    expect(oldQuote).toMatch(
      /NEW\."quoteSnapshot"\s+IS DISTINCT FROM\s+OLD\."quoteSnapshot"/i,
    );
    expect(oldQuote).not.toMatch(/OLD\."quoteSnapshot"\s+IS NOT NULL/i);
  });

  it('declares nullable initiation evidence, tenant replay key and scoped intent identity', () => {
    expect(intent).toMatch(
      /initiationRequestKey\s+String\?\s+@db\.VarChar\(100\)/,
    );
    expect(intent).toMatch(
      /initiationRequestHash\s+String\?\s+@db\.VarChar\(64\)/,
    );
    expect(intent).toMatch(/initiatedById\s+String\?/);
    expect(intent).toMatch(/initiationResult\s+Json\?/);
    for (const [field, type] of [
      ['initiationRequestKey', 'VARCHAR\\(100\\)'],
      ['initiationRequestHash', 'VARCHAR\\(64\\)'],
      ['initiatedById', 'TEXT'],
      ['initiationResult', 'JSONB'],
    ]) {
      expect(ddl).toMatch(
        new RegExp(`ADD\\s+COLUMN\\s+"${field}"\\s+${type}\\s*[,;]`, 'i'),
      );
    }
    for (const fields of [
      'organizationId,initiationRequestKey',
      'id,organizationId',
    ]) {
      expect(compact(intent)).toContain(`@@unique([${fields}])`);
      const columns = fields
        .split(',')
        .map((field) => `"${field}"`)
        .join(',');
      expect(compact(ddl)).toMatch(
        new RegExp(
          `CREATEUNIQUEINDEX[^;]+ON"PosLoanSaleIntent"\\(${columns}\\)`,
        ),
      );
    }
    expect(ddl).toMatch(
      /FOREIGN\s+KEY\s*\(\s*"initiatedById"\s*\)\s+REFERENCES\s+"User"\s*\(\s*"id"\s*\)/i,
    );
    expect(intent).toMatch(
      /\sUser\?\s+@relation\([^\n]*fields:\s*\[initiatedById\]/,
    );
    expect(model('User')).toMatch(/\sPosLoanSaleIntent\[\]\s+@relation/);
  });

  it('declares all-null legacy or all-populated evidence and canonical SHA256', () => {
    expect(ddl).toMatch(
      /CHECK\s*\([\s\S]*?num_nonnulls\(\s*"initiationRequestKey",\s*"initiationRequestHash",\s*"initiatedById",\s*"initiationResult"\s*\)\s+IN\s*\(\s*0,\s*4\s*\)/i,
    );
    expect(ddl).toMatch(/"initiationRequestHash"\s*~\s*'\^\[0-9a-f\]\{64\}\$'/);
    const body = guard('PosLoanSaleIntent', 'INSERT\\s+OR\\s+UPDATE');
    for (const field of [
      'initiationRequestKey',
      'initiationRequestHash',
      'initiatedById',
      'initiationResult',
    ]) {
      expect(body).toMatch(
        new RegExp(
          `NEW\\."${field}"\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\."${field}"`,
          'i',
        ),
      );
    }
    expect(body).not.toMatch(/OLD\."initiation\w+"\s+IS\s+NOT\s+NULL/i);
    expect(body).toMatch(
      /IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN[\s\S]*?RAISE\s+EXCEPTION[\s\S]*?END\s+IF\s*;\s*RETURN\s+NEW\s*;\s*END\s+IF/i,
    );
  });

  it('keeps the initiating loan creator immutable alongside principal and counterparties', () => {
    const collections = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20261009010000_money_loan_collections/migration.sql',
      ),
      'utf8',
    );
    const identity = collections
      .split('CREATE FUNCTION protect_money_loan_identity()')[1]
      .split('$$;')[0];
    const fields = [
      'amount',
      'organizationId',
      'customerId',
      'supplierId',
      'employeeId',
      'createdById',
    ];
    const tuple = (side: string) =>
      `(${fields.map((field) => `${side}."${field}"`).join(', ')})`;
    expect(identity).toContain(
      `${tuple('NEW')}\n     IS DISTINCT FROM\n     ${tuple('OLD')}`,
    );
    expect(identity).toContain('RAISE EXCEPTION');
  });

  it('defers existing stock bounds validation without weakening future row checks', () => {
    const foundation = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20261009030000_product_reservation_foundation/migration.sql',
      ),
      'utf8',
    );
    const foundationDdl = foundation.replace(/--[^\n]*/g, '');
    expect(foundationDdl).toContain(
      'ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0',
    );
    expect(foundationDdl).toMatch(
      /ADD CONSTRAINT "Product_reservedStock_bounds_check"\s+CHECK \("reservedStock" >= 0 AND \("stock" < 0 OR "reservedStock" <= "stock"\)\) NOT VALID,/,
    );
    // NOT VALID skips the deploy-time scan, but PostgreSQL still enforces the check
    // on every later UPDATE, so the stock bound itself must tolerate inherited
    // negative stock or that product could never be sold again.
    expect(foundationDdl).toContain('"stock" < 0 OR');
    expect(foundationDdl).toMatch(
      /ADD CONSTRAINT "Product_reservedStock_eligibility_check"\s+CHECK \("reservedStock" = 0 OR\s+\("active" = true AND "type" = 'PRODUCT' AND "tracksStock" = true\)\);/,
    );
    expect(foundationDdl).not.toMatch(/VALIDATE CONSTRAINT|UPDATE|DELETE/);
  });

  it('binds populated server results to the quoted MONEY loan and initiating actor', () => {
    const body = guard('PosLoanSaleIntent', 'INSERT\\s+OR\\s+UPDATE');
    expect(body).toMatch(
      /NEW\."initiationRequestKey"\s+IS\s+NULL\s+THEN\s+RETURN\s+NEW/i,
    );
    expect(body).toMatch(
      /NEW\."quoteSnapshot"\s+IS\s+NULL[\s\S]*?RAISE\s+EXCEPTION/i,
    );
    expect(body).toMatch(/FROM\s+"MoneyLoan"[\s\S]*?"type"\s*=\s*'MONEY'/i);
    for (const [parent, child] of [
      ['id', 'loanId'],
      ['organizationId', 'organizationId'],
      ['customerId', 'customerId'],
      ['amount', 'agreedCustomerTotal'],
      ['createdById', 'initiatedById'],
    ])
      expect(body).toMatch(
        new RegExp(`"${parent}"\\s*=\\s*NEW\\."${child}"`, 'i'),
      );
    expect(body).toMatch(
      /jsonb_typeof\(NEW\."initiationResult"\)\s+IS\s+DISTINCT\s+FROM\s*'object'/i,
    );
    for (const [key, field] of [
      ['intentId', 'id'],
      ['loanId', 'loanId'],
      ['organizationId', 'organizationId'],
      ['customerId', 'customerId'],
      ['agreedCustomerTotal', 'agreedCustomerTotal'],
    ])
      expect(body).toMatch(
        new RegExp(
          `->>\\s*'${key}'[\\s\\S]*?IS\\s+DISTINCT\\s+FROM\\s+NEW\\."${field}"`,
          'i',
        ),
      );
    expect(body).toMatch(
      /->\s*'(?:quote|quoteSnapshot)'\)?\s+IS\s+DISTINCT\s+FROM\s+NEW\."quoteSnapshot"/i,
    );
    expect(body).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('declares owned positive HELD rows with nullable terminal evidence and backlinks', () => {
    expect(schema).toMatch(
      /enum PosLoanSaleReservationState\s*\{\s*HELD\s+CONSUMED\s+RELEASED\s*\}/,
    );
    expect(ddl).toMatch(
      /CREATE\s+TYPE\s+"PosLoanSaleReservationState"\s+AS\s+ENUM\s*\(\s*'HELD',\s*'CONSUMED',\s*'RELEASED'\s*\)/i,
    );
    expect(reservation).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
    for (const field of ['intentId', 'organizationId', 'productId']) {
      expect(reservation).toMatch(
        new RegExp(`\\b${field}\\s+String(?!\\?)\\b`),
      );
      expect(table).toMatch(new RegExp(`"${field}"\\s+TEXT\\s+NOT NULL`, 'i'));
    }
    expect(table).toMatch(/PRIMARY\s+KEY\s*\(\s*"id"\s*\)/i);
    expect(reservation).toMatch(/quantity\s+Int\b/);
    expect(table).toMatch(/"quantity"\s+INTEGER\s+NOT\s+NULL/i);
    expect(ddl).toMatch(/CHECK\s*\(\s*"quantity"\s*>\s*0\s*\)/i);
    expect(reservation).toMatch(
      /state\s+PosLoanSaleReservationState\s+@default\(HELD\)/,
    );
    expect(table).toMatch(
      /"state"\s+"PosLoanSaleReservationState"\s+NOT\s+NULL\s+DEFAULT\s+'HELD'/i,
    );
    expect(reservation).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(table).toMatch(
      /"createdAt"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i,
    );
    expect(reservation).toMatch(/finalizedAt\s+DateTime\?/);
    expect(reservation).toMatch(/finalizedById\s+String\?/);
    expect(table).toMatch(/"finalizedAt"\s+TIMESTAMP\(3\)\s*[,\n]/i);
    expect(table).toMatch(/"finalizedById"\s+TEXT\s*[,\n]/i);
    for (const parent of [
      'User',
      'Organization',
      'Product',
      'PosLoanSaleIntent',
    ]) {
      expect(model(parent)).toMatch(/\sPosLoanSaleReservation\[\]/);
    }
  });

  it('declares restrictive scoped ownership, actor FK and one row per intent product', () => {
    expect(compact(reservation)).toContain('@@unique([intentId,productId])');
    expect(compact(ddl)).toMatch(
      /CREATEUNIQUEINDEX[^;]+ON"PosLoanSaleReservation"\("intentId","productId"\)/,
    );
    for (const [parent, fields, refs] of [
      ['PosLoanSaleIntent', 'intentId,organizationId', 'id,organizationId'],
      ['Product', 'productId,organizationId', 'id,organizationId'],
      ['Organization', 'organizationId', 'id'],
      ['User', 'finalizedById', 'id'],
    ]) {
      const relation =
        reservation
          .split('\n')
          .find((line) =>
            new RegExp(`\\s${parent}\\??\\s+@relation\\(`).test(line),
          ) ?? '';
      expect(compact(relation)).toContain(
        `fields:[${fields}],references:[${refs}]`,
      );
      expect(compact(relation)).toContain(
        'onDelete:Restrict,onUpdate:Restrict',
      );
      const columns = (names: string) =>
        names
          .split(',')
          .map((name) => `"${name}"`)
          .join(',');
      expect(compact(table)).toContain(
        `FOREIGNKEY(${columns(fields)})REFERENCES"${parent}"(${columns(refs)})ONDELETERESTRICTONUPDATERESTRICT`,
      );
    }
  });

  it('declares insert-only eligibility and aggregate frozen quantities, not live repricing', () => {
    const body = guard(
      'PosLoanSaleReservation',
      'INSERT\\s+OR\\s+UPDATE\\s+OR\\s+DELETE',
    );
    expect(body).toMatch(/IF\s+TG_OP\s*=\s*'INSERT'\s+THEN/i);
    expect(body).toMatch(
      /NEW\."state"\s*(?:<>|IS\s+DISTINCT\s+FROM)\s*'HELD'/i,
    );
    expect(body).toMatch(/NEW\."finalizedAt"\s+IS\s+NOT\s+NULL/i);
    expect(body).toMatch(/NEW\."finalizedById"\s+IS\s+NOT\s+NULL/i);
    expect(body).toMatch(/FROM\s+"PosLoanSaleIntent"/i);
    expect(body).toMatch(/"id"\s*=\s*NEW\."intentId"/i);
    expect(body).toMatch(/FROM\s+"MoneyLoan"|JOIN\s+"MoneyLoan"/i);
    expect(body).toMatch(/"id"\s*=\s*\w+\."loanId"/i);
    expect(body).toMatch(/"type"\s*=\s*'MONEY'/i);
    expect(body).toMatch(/"amount"\s*=\s*\w+\."agreedCustomerTotal"/i);
    expect(body).toMatch(/"createdById"\s*=\s*\w+\."initiatedById"/i);
    expect(body).toMatch(/"customerId"\s*=\s*\w+\."customerId"/i);
    expect(body).toMatch(/"organizationId"\s*=\s*NEW\."organizationId"/i);
    expect(body).toMatch(
      /jsonb_array_elements\([^;]*"quoteSnapshot"\s*->\s*'items'\)/i,
    );
    expect(body).toMatch(/SUM\([^;]*->>\s*'quantity'/i);
    expect(body).toMatch(/->>\s*'productId'\s*=\s*NEW\."productId"/i);
    expect(body).toMatch(/NEW\."quantity"\s+IS\s+DISTINCT\s+FROM/i);
    expect(body).toMatch(/FROM\s+"Product"/i);
    expect(body).toMatch(/"type"\s*=\s*'PRODUCT'/i);
    expect(body).toMatch(/"tracksStock"\s*=\s*(?:true|TRUE)/);
    expect(body).toMatch(/"active"\s*=\s*(?:true|TRUE)/);
    const updateBranch = body.match(/IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN/i);
    expect(updateBranch).not.toBeNull();
    const update = updateBranch ? body.slice(updateBranch.index) : '';
    expect(update).not.toMatch(
      /FROM\s+"Product"|"tracksStock"|"active"|"salePrice"/i,
    );
  });

  it('declares immutable ownership, delete protection and irreversible terminal transitions', () => {
    const body = guard(
      'PosLoanSaleReservation',
      'INSERT\\s+OR\\s+UPDATE\\s+OR\\s+DELETE',
    );
    expect(body).toMatch(
      /IF\s+TG_OP\s*=\s*'DELETE'\s+THEN\s+RAISE\s+EXCEPTION/i,
    );
    for (const field of [
      'id',
      'intentId',
      'organizationId',
      'productId',
      'quantity',
      'createdAt',
    ]) {
      expect(body).toMatch(
        new RegExp(
          `NEW\\."${field}"\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\."${field}"`,
          'i',
        ),
      );
    }
    expect(body).toMatch(
      /OLD\."state"\s*(?:<>|!=|IS\s+DISTINCT\s+FROM)\s*'HELD'/i,
    );
    for (const field of ['state', 'finalizedAt', 'finalizedById']) {
      expect(body).toMatch(
        new RegExp(
          `NEW\\."${field}"\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\."${field}"`,
          'i',
        ),
      );
    }
    expect(body).toMatch(
      /NEW\."state"\s*=\s*'CONSUMED'[\s\S]*?"finalSaleId"\s+IS\s+NOT\s+NULL/i,
    );
    expect(body).toMatch(
      /NEW\."state"\s*=\s*'RELEASED'[\s\S]*?"status"\s*=\s*'CANCELLED'[\s\S]*?"finalSaleId"\s+IS\s+NULL/i,
    );
    expect(ddl).toMatch(
      /CHECK\s*\([\s\S]*?"state"\s*=\s*'HELD'[\s\S]*?"finalizedAt"\s+IS\s+NULL[\s\S]*?"finalizedById"\s+IS\s+NULL[\s\S]*?"finalizedAt"\s+IS\s+NOT\s+NULL[\s\S]*?"finalizedById"\s+IS\s+NOT\s+NULL/i,
    );
    expect(body).toMatch(/RAISE\s+EXCEPTION/i);
    expect(body).toMatch(/RETURN\s+NEW\s*;/i);
  });

  it('adds storage declarations without backfill, counter writes or financial activation', () => {
    expect(ddl).not.toMatch(
      /\b(?:DROP|TRUNCATE)\b|\bUPDATE\s+"|\bDELETE\s+FROM|\bINSERT\s+INTO/i,
    );
    expect(
      [...ddl.matchAll(/CREATE\s+TABLE\s+"([^"]+)"/gi)].map(
        (match) => match[1],
      ),
    ).toEqual(['PosLoanSaleReservation']);
    expect(ddl).not.toMatch(
      /"(?:Payment|SaleItem|InventoryMovement|AuditLog|MoneyLoanEvent|reservedStock)"/,
    );
    expect(ddl).not.toMatch(
      /protect_pos_loan_sale_quote|protect_pos_loan_sale_intent|PosLoanSaleIntent_protect/i,
    );
  });
});
