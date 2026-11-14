import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009080000_pos_loan_sale_intent/migration.sql',
);
// Absent planned SQL is assertion input, not a fixture or a read-time exception.
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const schema = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);
const legacySql = readFileSync(
  resolve(
    __dirname,
    '../../prisma/migrations/20261009000000_add_money_loans/migration.sql',
  ),
  'utf8',
);
const modelBody = (name: string) =>
  schema.split(`model ${name} {`)[1]?.split('\n}')[0] ?? '';
const compact = (source: string) => source.replace(/\s+/g, '');
const intent = modelBody('PosLoanSaleIntent');
const ddl = compact(sql);
const table =
  sql.match(/CREATE\s+TABLE\s+"PosLoanSaleIntent"\s*\(([\s\S]*?)\);/i)?.[1] ??
  '';
const columns = (names: readonly string[]) =>
  names.map((name) => `"${name}"`).join(',');
const scope = ['id', 'organizationId', 'customerId'];

// Source declarations only: no PostgreSQL execution, trigger behavior or CAS/race proof.
describe('POS loan sale intent declarations (not executed SQL)', () => {
  it('retains independent loans and nullable legacy sale customers', () => {
    expect(modelBody('MoneyLoan')).toMatch(/customerId\s+String\?/);
    expect(modelBody('MoneyLoan')).toMatch(/supplierId\s+String\?/);
    expect(modelBody('MoneyLoan')).toMatch(/employeeId\s+String\?/);
    expect(modelBody('MoneyLoan')).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(modelBody('MoneyLoan')).not.toMatch(/^\s*origin\s/m);
    expect(modelBody('Sale')).toMatch(/customerId\s+String\?/);
    expect(compact(modelBody('Customer'))).toContain(
      '@@unique([id,organizationId])',
    );
    expect(compact(legacySql)).toContain(
      'num_nonnulls("customerId","supplierId","employeeId")=1',
    );
  });

  it('declares a minimal child with server creation metadata and single claims', () => {
    expect(schema).toContain('model PosLoanSaleIntent {');
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/CREATE\s+TABLE\s+"PosLoanSaleIntent"/i);
    expect(intent).toMatch(/\bid\s+String\s+@id\s+@default\(uuid\(\)\)/);
    for (const field of ['organizationId', 'loanId', 'customerId']) {
      expect(intent).toMatch(new RegExp(`\\b${field}\\s+String(?!\\?)\\b`));
      expect(table).toMatch(new RegExp(`"${field}"\\s+TEXT\\s+NOT NULL`, 'i'));
    }
    expect(table).toMatch(/PRIMARY\s+KEY\s*\(\s*"id"\s*\)/i);
    expect(intent).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(table).toMatch(
      /"createdAt"\s+TIMESTAMP(?:\(\d+\))?\s+NOT NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i,
    );
    expect(intent).toMatch(/finalSaleId\s+String\?\s+@unique/);
    expect(table).toMatch(/"finalSaleId"\s+TEXT\s*[,\n]/i);
    expect(intent).toMatch(/loanId\s+String\s+@unique/);
    for (const field of ['loanId', 'finalSaleId']) {
      expect(ddl).toMatch(
        new RegExp(
          `CREATEUNIQUEINDEX[^;]+ON"PosLoanSaleIntent"\\("${field}"\\)`,
        ),
      );
    }
    expect(intent).not.toMatch(
      /\b(?:origin|amount|price|total|status|items|payments|createdById|actorId)\s/,
    );
  });

  it('declares scoped restrictive relations and optional one-to-one backlinks', () => {
    for (const [target, fields, references, optional] of [
      ['Organization', ['organizationId'], ['id'], false],
      [
        'Customer',
        ['customerId', 'organizationId'],
        ['id', 'organizationId'],
        false,
      ],
      ['MoneyLoan', ['loanId', 'organizationId', 'customerId'], scope, false],
      ['Sale', ['finalSaleId', 'organizationId', 'customerId'], scope, true],
    ] as const) {
      const relation =
        intent
          .split('\n')
          .find((line) =>
            new RegExp(
              `\\s${target}${optional ? '\\?' : ''}\\s+@relation\\(`,
            ).test(line),
          ) ?? '';
      expect(compact(relation)).toContain(
        `fields:[${fields.join(',')}],references:[${references.join(',')}]`,
      );
      expect(compact(relation)).toContain('onDelete:Restrict');
      expect(compact(relation)).toContain('onUpdate:Restrict');
      expect(ddl).toContain(
        `FOREIGNKEY(${columns(fields)})REFERENCES"${target}"(${columns(references)})ONDELETERESTRICTONUPDATERESTRICT`,
      );
    }
    for (const parent of ['MoneyLoan', 'Sale']) {
      expect(compact(modelBody(parent))).toContain(
        `@@unique([${scope.join(',')}])`,
      );
      expect(ddl).toMatch(
        new RegExp(
          `CREATEUNIQUEINDEX[^;]+ON"${parent}"\\(${columns(scope)}\\)`,
        ),
      );
      expect(modelBody(parent)).toMatch(/\sPosLoanSaleIntent\?\s/);
    }
    for (const parent of ['Customer', 'Organization']) {
      expect(modelBody(parent)).toMatch(/\sPosLoanSaleIntent\[\]\s/);
    }
    expect(sql).not.toMatch(/MATCH\s+FULL/i);
  });

  it('declares delete protection, immutable identity and a non-replaceable final claim', () => {
    const trigger = sql.match(
      /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"PosLoanSaleIntent"\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+"([^"]+)"\(\)/i,
    );
    expect(trigger).not.toBeNull();
    // Resolve the real trigger function instead of prescribing its identifier.
    const functions = [
      ...sql.matchAll(
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"([^"]+)"\(\)\s+RETURNS\s+trigger\s+AS\s+\$\$([\s\S]*?)\$\$\s+LANGUAGE\s+plpgsql/gi,
      ),
    ];
    const guard =
      functions.find((match) => match[1] === trigger?.[1])?.[2] ?? '';
    expect(guard).toMatch(
      /IF\s+TG_OP\s*=\s*'DELETE'\s+THEN\s+RAISE\s+EXCEPTION/i,
    );
    for (const field of [
      'id',
      'organizationId',
      'loanId',
      'customerId',
      'createdAt',
    ]) {
      expect(guard).toMatch(
        new RegExp(
          `NEW\\."${field}"\\s+IS DISTINCT FROM\\s+OLD\\."${field}"`,
          'i',
        ),
      );
    }
    expect(guard).toMatch(
      /OLD\."finalSaleId"\s+IS NOT NULL\s+AND\s+NEW\."finalSaleId"\s+IS DISTINCT FROM\s+OLD\."finalSaleId"/i,
    );
    expect(guard).toMatch(/THEN\s+RAISE\s+EXCEPTION/i);
    expect(guard).toMatch(/RETURN\s+NEW\s*;/i);
    expect(guard).not.toMatch(/NEW\."finalSaleId"\s+IS NOT NULL/i);
  });

  it('adds only intent persistence and parent keys, without financial or kind policy changes', () => {
    expect(sql).not.toMatch(
      /\b(?:DROP|TRUNCATE)\b|\bUPDATE\s+"|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b/i,
    );
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER)\s+TYPE\b|\bADD\s+COLUMN\b/i);
    expect(
      [...sql.matchAll(/CREATE\s+TABLE\s+"([^"]+)"/gi)].map(
        (match) => match[1],
      ),
    ).toEqual(['PosLoanSaleIntent']);
    expect(sql).not.toMatch(
      /"(?:Payment|MoneyLoanEvent|AuditLog|SaleItem)"|'(?:MONEY|SERVICE)'/,
    );
    expect(table).not.toMatch(
      /"(?:amount|price|total|status|items|payments|createdById|actorId)"/,
    );
    expect(schema).not.toContain('model MoneyLoanSale {');
    expect(modelBody('Sale')).not.toMatch(/^\s*(?:supplierId|employeeId)\s/m);
  });
});

const checkoutMigrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009110000_pos_loan_checkout_quote/migration.sql',
);
const checkoutSql = existsSync(checkoutMigrationPath)
  ? readFileSync(checkoutMigrationPath, 'utf8')
  : '';

describe('POS checkout quote extension declarations (not executed SQL)', () => {
  it('retains legacy guards and strictly validates the complete extended shape', () => {
    declares(checkoutSql, [
      /CREATE OR REPLACE FUNCTION "protect_pos_loan_sale_quote"/,
      /IF TG_OP = 'UPDATE'[\s\S]*?RETURN NEW;[\s\S]*?extended :=/,
      /NEW\."quoteSnapshot" IS DISTINCT FROM OLD\."quoteSnapshot"/,
      /NEW\."agreedCustomerTotal" IS DISTINCT FROM OLD\."agreedCustomerTotal"/,
      /extended := snapshot \? 'discountAmount'/,
      /ELSE ARRAY\['productId', 'quantity', 'resolvedUnitPrice', 'discountAmount'\]/,
      /jsonb_typeof\(snapshot -> 'discountAmount'\) IS DISTINCT FROM 'string'/,
      /jsonb_typeof\(item -> 'taxRate'\) IS DISTINCT FROM 'number'/,
      /jsonb_typeof\(item -> 'costPriceSnapshot'\) IS DISTINCT FROM 'string'/,
      /scale\(\(item ->> 'taxRate'\)::numeric\) > 2/,
      /\(item ->> 'taxRate'\)::numeric > 999\.99/,
      /l\."amount" = NEW\."agreedCustomerTotal"/,
      /p\."organizationId" = NEW\."organizationId"/,
    ]);
    expect(checkoutSql).not.toMatch(
      /ALTER TABLE|UPDATE "|DELETE FROM|INSERT INTO/,
    );
  });
});

const quoteMigrationPath = resolve(
  __dirname,
  '../../prisma/migrations/20261009090000_pos_loan_sale_quote/migration.sql',
);
// Missing planned DDL must fail assertions, never module loading.
const quoteSql = existsSync(quoteMigrationPath)
  ? readFileSync(quoteMigrationPath, 'utf8')
  : '';
const quoteDdl = quoteSql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
const quoteFunctions = [
  ...quoteDdl.matchAll(
    /CREATE\s+FUNCTION\s+"([^"]+)"\([^)]*\)\s+RETURNS\s+\w+\s+AS\s+\$\$([\s\S]*?)\$\$\s+LANGUAGE\s+plpgsql/gi,
  ),
];
const quoteTrigger = quoteDdl.match(
  /BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+"PosLoanSaleIntent"\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+"([^"]+)"\(\)/i,
);
const quoteGuard =
  quoteFunctions.find((match) => match[1] === quoteTrigger?.[1])?.[2] ?? '';
const quoteValidation = quoteFunctions.map((match) => match[2]).join('\n');
const declares = (source: string, patterns: RegExp[]) => {
  for (const pattern of patterns) expect(source).toMatch(pattern);
};

// Deliberately structural RED: execution, atomic initiation and serialization
// belong to later coverage; these declarations do not prove PostgreSQL behavior.
describe('POS loan frozen quote declarations (not executed SQL)', () => {
  it('adds only two nullable quote fields at the existing loan precision', () => {
    expect(existsSync(quoteMigrationPath)).toBe(true);
    declares(intent, [
      /\bquoteSnapshot\s+Json\?/,
      /\bagreedCustomerTotal\s+Decimal\?\s+@db\.Decimal\(10,\s*2\)/,
    ]);
    declares(modelBody('MoneyLoan'), [
      /\bamount\s+Decimal\s+@db\.Decimal\(10,\s*2\)/,
    ]);
    declares(quoteDdl, [
      /ADD\s+COLUMN\s+"quoteSnapshot"\s+JSONB\s*[,;]/i,
      /ADD\s+COLUMN\s+"agreedCustomerTotal"\s+DECIMAL\(10,\s*2\)\s*[,;]/i,
    ]);
    const added = [...quoteDdl.matchAll(/ADD\s+COLUMN\s+"([^"]+)"/gi)];
    expect(added.map((m) => m[1])).toEqual([
      'quoteSnapshot',
      'agreedCustomerTotal',
    ]);
    expect(quoteDdl).not.toMatch(/\b(?:NOT\s+NULL|DEFAULT)\b/i);
  });

  it('declares a both-null or both-populated pair and a positive quoted scalar', () => {
    declares(quoteDdl, [
      /CHECK\s*\([\s\S]*?\("quoteSnapshot"\s+IS\s+NULL\)\s*=\s*\("agreedCustomerTotal"\s+IS\s+NULL\)/i,
      /CHECK\s*\(\s*"agreedCustomerTotal"\s*>\s*0\s*\)/i,
    ]);
    expect(quoteTrigger).not.toBeNull();
    declares(quoteGuard, [
      /NEW\."quoteSnapshot"\s+IS\s+NULL\s+THEN\s+RETURN\s+NEW/i,
    ]);
  });

  it('rejects every quote update, including clearing and legacy null-to-value filling', () => {
    // No OLD-is-not-null qualification: legacy nulls are frozen from insertion too.
    declares(quoteGuard, [
      /IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN/i,
      /IF\s+NEW\."quoteSnapshot"\s+IS\s+DISTINCT\s+FROM\s+OLD\."quoteSnapshot"\s+OR\s+NEW\."agreedCustomerTotal"\s+IS\s+DISTINCT\s+FROM\s+OLD\."agreedCustomerTotal"\s+THEN\s+RAISE\s+EXCEPTION/i,
    ]);
    expect(quoteGuard).not.toMatch(
      /OLD\."(?:quoteSnapshot|agreedCustomerTotal)"\s+IS\s+NOT\s+NULL/i,
    );
  });

  it('returns unchanged updates before insert validation, preserving final-sale claims', () => {
    // Required declaration shape: update guard, then early RETURN, then insert checks.
    declares(quoteGuard, [
      /IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN[\s\S]*?RAISE\s+EXCEPTION[\s\S]*?END\s+IF\s*;\s*RETURN\s+NEW\s*;\s*END\s+IF\s*;/i,
    ]);
    const updateBlock = quoteGuard.match(
      /IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN[\s\S]*?RAISE\s+EXCEPTION[\s\S]*?END\s+IF\s*;\s*RETURN\s+NEW\s*;\s*END\s+IF\s*;/i,
    );
    expect(updateBlock).not.toBeNull();
    const afterUpdate = updateBlock
      ? quoteGuard.slice((updateBlock.index ?? 0) + updateBlock[0].length)
      : '';
    expect(afterUpdate).toMatch(/FROM\s+"MoneyLoan"/i);
    expect(afterUpdate).toMatch(/FROM\s+"Product"/i);
    expect(quoteGuard).not.toMatch(/NEW\."finalSaleId"/);
    expect(quoteDdl).not.toMatch(
      /protect_pos_loan_sale_intent|PosLoanSaleIntent_protect/,
    );
  });

  it('declares exact quote root and item keys, object types and a nonempty item array', () => {
    declares(quoteValidation, [
      /jsonb_typeof\([^)]*\)\s*(?:<>|!=|IS\s+DISTINCT\s+FROM)\s*'object'/i,
      /-\s*ARRAY\s*\[\s*'items'\s*,\s*'agreedCustomerTotal'\s*\][\s\S]*?'\{\}'/i,
      /-\s*ARRAY\s*\[\s*'productId'\s*,\s*'quantity'\s*,\s*'resolvedUnitPrice'\s*,\s*'discountAmount'\s*\][\s\S]*?'\{\}'/i,
      /jsonb_typeof\([^\n;]*->\s*'items'\)\s*(?:<>|!=|IS\s+DISTINCT\s+FROM)\s*'array'/i,
      /jsonb_array_length\([^)]*\)\s*=\s*0/i,
      /jsonb_array_elements\(/i,
      /RAISE\s+EXCEPTION/i,
    ]);
    for (const field of [
      'productId',
      'resolvedUnitPrice',
      'discountAmount',
      'agreedCustomerTotal',
    ]) {
      const typeCheck = `jsonb_typeof\\([^\\n;]*->\\s*'${field}'\\)`;
      declares(quoteValidation, [
        new RegExp(
          `${typeCheck}\\s*(?:<>|!=|IS\\s+DISTINCT\\s+FROM)\\s*'string'`,
          'i',
        ),
      ]);
    }
  });

  it('declares positive Prisma-int quantities and canonical bounded monetary strings', () => {
    declares(quoteValidation, [
      /jsonb_typeof\([^\n;]*->\s*'quantity'\)\s*(?:<>|!=|IS\s+DISTINCT\s+FROM)\s*'number'/i,
      /->>\s*'quantity'\)?\s*!~\s*'\^\[1-9\]\[0-9\]\*\$'/i,
      /->>\s*'quantity'[\s\S]*?>\s*2147483647/,
    ]);
    // 8 integral digits + exactly 2 fractional digits: Decimal(10,2), no sign,
    // exponent, leading zero, excess precision or negative discount/price.
    expect(quoteValidation).toContain("'^(0|[1-9][0-9]{0,7})[.][0-9]{2}$'");
    for (const field of [
      'resolvedUnitPrice',
      'discountAmount',
      'agreedCustomerTotal',
    ]) {
      const canonical =
        "'\\^\\(0\\|\\[1-9\\]\\[0-9\\]\\{0,7\\}\\)\\[\\.\\]\\[0-9\\]\\{2\\}\\$'";
      declares(quoteValidation, [
        new RegExp(`->>\\s*'${field}'\\)?\\s*!~\\s*${canonical}`),
      ]);
    }
  });

  it('binds the canonical JSON total to the scalar and the scoped parent at insert', () => {
    declares(quoteGuard, [
      /->>\s*'agreedCustomerTotal'[\s\S]*?IS\s+DISTINCT\s+FROM\s+NEW\."agreedCustomerTotal"/i,
      /FROM\s+"MoneyLoan"[\s\S]*?"id"\s*=\s*NEW\."loanId"/i,
      /"amount"\s*=\s*NEW\."agreedCustomerTotal"/i,
      /IF\s+NOT\s+EXISTS\s*\([\s\S]*?FROM\s+"MoneyLoan"[\s\S]*?THEN\s+RAISE\s+EXCEPTION/i,
    ]);
    for (const field of ['organizationId', 'customerId']) {
      const scoped = `"${field}"\\s*=\\s*NEW\\."${field}"`;
      declares(quoteGuard, [
        new RegExp(`FROM\\s+"MoneyLoan"[\\s\\S]*?${scoped}`, 'i'),
      ]);
    }
  });

  it('checks nonblank same-org product IDs only, without recatalog or financial writes', () => {
    declares(quoteValidation, [/btrim\([^\n;]*->>\s*'productId'\)\s*=\s*''/i]);
    declares(quoteGuard, [
      /IF\s+NOT\s+EXISTS\s*\([\s\S]*?FROM\s+"Product"[\s\S]*?"id"\s*=\s*[^\n;]*->>\s*'productId'[\s\S]*?"organizationId"\s*=\s*NEW\."organizationId"[\s\S]*?THEN\s+RAISE\s+EXCEPTION/i,
    ]);
    const altered = [...quoteDdl.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/gi)];
    expect(altered.map((m) => m[1])).toEqual(['PosLoanSaleIntent']);
    expect(quoteDdl).not.toMatch(
      /\b(?:DROP|TRUNCATE|CREATE\s+OR\s+REPLACE|CREATE\s+TABLE|ALTER\s+TYPE)\b|\bUPDATE\s+"|\bDELETE\s+FROM|\bINSERT\s+INTO/i,
    );
    expect(quoteDdl).not.toMatch(
      /"(?:Sale|SaleItem|Payment|MoneyLoanEvent|AuditLog)"/,
    );
    expect(quoteValidation).not.toMatch(
      /"(?:price|salePrice|cost|taxRate|stock|active|type)"|\bSUM\s*\(/i,
    );
  });
});
