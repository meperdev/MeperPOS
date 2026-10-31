// Golden equality gate for the reports query tuning (S5 — perf-refactor #98).
//
// The committed JSON files under backend/test/fixtures/reports-golden/ were
// captured from the UNMODIFIED ReportsService against the deterministic
// fixture organization seeded by seed-golden-fixtures.ts (see
// capture-goldens.ts). This spec re-seeds that fixture org in beforeAll and
// then re-runs the identical workload, so the gate is SELF-CONTAINED: it
// passes on any freshly migrated database (CI included) with no local seed
// data. It must keep passing while reports.service.ts is refactored; any
// output difference is a semantics regression.
//
// Regeneration policy: goldens may only be regenerated from unmodified
// reports.service.ts code (pre-refactor capture). Never regenerate goldens
// to make a failing gate pass — that defeats the gate.
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../common/services/cache.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ReportsService } from './reports.service';
import {
  GOLDEN_SCENARIOS,
  runReportWorkload,
  type ReportWorkloadOutputs,
} from './reports-golden-workload';
import { seedGoldenFixtures } from '../../test/fixtures/reports-golden/seed-golden-fixtures';

const GOLDEN_DIR = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'reports-golden',
);

interface OrgsManifest {
  orgs: Array<{ slug: string }>;
}

interface GoldenFile {
  _comment?: string;
  orgSlug: string;
  scenario: string;
  startDate: string;
  endDate: string;
  outputs: ReportWorkloadOutputs;
}

// Loaded synchronously so the test tree can be built from the manifest.
// A missing manifest is itself a RED state: capture the goldens first.
const manifest = JSON.parse(
  fs.readFileSync(path.join(GOLDEN_DIR, 'orgs.json'), 'utf-8'),
) as OrgsManifest;

// ─── Scoped order-insensitivity (maintainer decision) ────────────────────────
// The pre-refactor payment loops had NO orderBy, so the method-group array
// order in the goldens was a DB physical-row artifact, never a code contract
// (maintainer decision: Engram obs #411 / PR #103 — "Option 1: method-group
// order is non-semantic"). ONLY the two method-group arrays —
// getSalesByPaymentMethod `data` and getCashFlow `collections.byPaymentMethod`
// (also embedded in economicExport.cash) — are sorted by paymentMethod on BOTH
// sides before deep-equal; every OTHER assertion stays byte-strict (sorting
// cannot mask a value difference) — a recorded relaxation, not a weakening.
function isMethodGroupArray(
  value: unknown,
): value is Array<{ paymentMethod: string }> {
  return (
    Array.isArray(value) &&
    value.every((row) => typeof row?.paymentMethod === 'string')
  );
}

function sortMethodGroups(rows: Array<{ paymentMethod: string }>) {
  return [...rows].sort((a, b) =>
    a.paymentMethod.localeCompare(b.paymentMethod),
  );
}

function withSortedMethodGroups(key: string, output: unknown): unknown {
  if (typeof output !== 'object' || output === null) return output;
  if (key === 'salesPaymentMethod') {
    const sales = output as { data?: unknown };
    return isMethodGroupArray(sales?.data)
      ? { ...sales, data: sortMethodGroups(sales.data) }
      : output;
  }
  const cashflow =
    key === 'economicCash'
      ? (output as { collections?: { byPaymentMethod?: unknown } })
      : key === 'economicExport'
        ? (output as { cash?: { collections?: { byPaymentMethod?: unknown } } })
            .cash
        : undefined;
  const byPaymentMethod = cashflow?.collections?.byPaymentMethod;
  if (!isMethodGroupArray(byPaymentMethod)) return output;
  const sorted = {
    ...cashflow!,
    collections: {
      ...cashflow!.collections,
      byPaymentMethod: sortMethodGroups(byPaymentMethod),
    },
  };
  // `expensePayments` merges expense payments with payroll cash and returns, and
  // the service reads them without an ORDER BY, so its group order is unspecified
  // by contract. The golden compares the numbers, never the row order.
  const expenseGroups = (
    sorted as { expensePayments?: { byPaymentMethod?: unknown } }
  ).expensePayments?.byPaymentMethod;
  const normalized = isMethodGroupArray(expenseGroups)
    ? {
        ...sorted,
        expensePayments: {
          ...(sorted as { expensePayments: object }).expensePayments,
          byPaymentMethod: sortMethodGroups(expenseGroups),
        },
      }
    : sorted;
  return key === 'economicExport'
    ? { ...output, cash: normalized }
    : normalized;
}

describe('Reports golden equality (S5 perf-refactor #98)', () => {
  let prisma: PrismaService;
  let service: ReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    // Self-contained gate: seed the deterministic fixture org so the suite
    // never depends on local seed data (CI runs against an empty-but-migrated
    // database).
    await seedGoldenFixtures(prisma);
    const cache = new CacheService();
    const expenses = new ExpensesService(
      prisma,
      new CloudinaryService(new ConfigService()),
    );
    service = new ReportsService(prisma, cache, expenses);
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  for (const { slug } of manifest.orgs) {
    for (const scenario of GOLDEN_SCENARIOS) {
      const fileName = `golden-${slug}-${scenario.name}.json`;

      describe(`${slug} / ${scenario.name}`, () => {
        const golden = JSON.parse(
          fs.readFileSync(path.join(GOLDEN_DIR, fileName), 'utf-8'),
        ) as GoldenFile;
        let actual: ReportWorkloadOutputs;

        beforeAll(async () => {
          const org = await prisma.organization.findUnique({ where: { slug } });
          if (!org) {
            throw new Error(
              `Organization "${slug}" from the goldens manifest was not found in the database`,
            );
          }
          actual = await runReportWorkload(service, org.id, scenario);
        });

        for (const key of Object.keys(golden.outputs)) {
          it(`matches golden output: ${key}`, () => {
            const parsed = JSON.parse(JSON.stringify(actual[key]));
            const expected = JSON.parse(JSON.stringify(golden.outputs[key]));
            expect(withSortedMethodGroups(key, parsed)).toEqual(
              withSortedMethodGroups(key, expected),
            );
          });
        }
      });
    }
  }
});
