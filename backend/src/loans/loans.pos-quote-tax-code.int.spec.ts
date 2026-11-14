/**
 * T4i — real-PostgreSQL proof for the financed POS quote trigger.
 *
 * The quote snapshot gained a seventh row key (`taxCode`), and the historical
 * trigger only allowed six, so every new financed quote failed with P0001
 * "unknown keys" before migration 20261106180000 replaced that validation
 * function. This suite covers the trigger by itself: it writes quote rows
 * straight through Prisma, so it proves what the database accepts and refuses
 * without borrowing a verdict from the service writer.
 *
 * It was split out of `loans.pos-fiscal.int.spec.ts` so the migration can be
 * exercised and reviewed on committed pre-feature service state. Nothing here
 * imports `LoansService`, and nothing here touches the fiscal document model or
 * financed completion; both suites share only the runtime requirement below and
 * keep the same fixture, verbatim, so the moved assertions did not change.
 *
 * Both historical quote generations are pinned as accepted exactly as written:
 * the six-key one and the oldest four-key one. A four-key row cannot be
 * completed by the current service, so the four-key acceptance stops at
 * storage: the frozen quote, its initiation evidence, and the absence of any
 * reservation, sale or loan change.
 *
 * The suite is bound to an explicitly provided isolated database and creates its
 * own uniquely named rows; it never deletes, resets or migrates anything. Run it
 * with `DATABASE_URL` pointing at a freshly migrated isolated database, e.g.
 *
 *   DATABASE_URL=postgresql://... npx jest --runInBand \
 *     src/loans/loans.pos-quote-tax-code.int.spec.ts
 */
import {
  DianTaxCode,
  OrgRole,
  PlanType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { randomUUID } from 'crypto';

const databaseUrl = process.env.DATABASE_URL;

type Fixture = {
  organizationId: string;
  customerId: string;
  productId: string;
  userId: string;
};

describe('POS loan quote trigger — taxCode migration (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let tag: string;
  let active: Fixture;
  let inactive: Fixture;

  const money = (value: string) => new Prisma.Decimal(value);
  const nextTag = () => `${tag}-${randomUUID()}`;

  const makeFixture = async (
    label: string,
    settings: Prisma.InputJsonValue,
  ): Promise<Fixture> => {
    const organization = await prisma.organization.create({
      data: {
        name: `T4i ${label}`,
        slug: `${tag}-${label}`,
        plan: PlanType.BASIC,
        active: true,
        taxId: label === 'active' ? '900123456' : null,
        settings,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `${tag}-${label}@t4i.test`,
        password: 'not-a-real-password',
        name: `T4i ${label} cashier`,
      },
    });
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: OrgRole.CASHIER,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        name: `T4i ${label} customer`,
        documentType: 'CC',
        documentNumber: `900${label === 'active' ? '1' : '2'}11222`,
        organizationId: organization.id,
      },
    });
    const category = await prisma.category.create({
      data: {
        name: `${tag}-${label}-category`,
        organizationId: organization.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: `T4i ${label} product`,
        sku: `${tag}-${label}-sku`,
        costPrice: money('40.00'),
        salePrice: money('100.00'),
        taxRate: money('19.00'),
        taxCode: DianTaxCode.IVA,
        taxable: true,
        promotionType: 'PERCENTAGE',
        promotionValue: money('20.00'),
        stock: 10,
        reservedStock: 0,
        type: 'PRODUCT',
        tracksStock: true,
        categoryId: category.id,
        organizationId: organization.id,
      },
    });
    await prisma.organizationSequence.create({
      data: {
        organizationId: organization.id,
        type: 'SALE',
        year: new Date().getFullYear(),
        currentNumber: 0,
      },
    });
    return {
      organizationId: organization.id,
      customerId: customer.id,
      productId: product.id,
      userId: user.id,
    };
  };

  const quoteItem = (fixture: Fixture, withTaxCode: boolean) => ({
    productId: fixture.productId,
    quantity: 2,
    resolvedUnitPrice: '80.00',
    discountAmount: '10.00',
    taxRate: 19,
    costPriceSnapshot: '40.00',
    ...(withTaxCode ? { taxCode: 'IVA' } : {}),
  });

  beforeAll(() => {
    if (!databaseUrl) {
      throw new Error(
        'This suite needs DATABASE_URL pointing at a freshly migrated isolated database',
      );
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    tag = `t4i-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  });

  beforeAll(async () => {
    active = await makeFixture('active', {
      electronicInvoicing: { enabled: true },
    });
    inactive = await makeFixture('inactive', {});
  });

  afterAll(async () => {
    // Rows stay: the isolated database is evidence, not a scratch pad.
    await prisma.$disconnect();
  });

  // Direct trigger coverage: the migration must narrow what a quote row may
  // carry, not merely stop rejecting our own writer.
  const probeLoan = (fixture: Fixture) =>
    prisma.moneyLoan.create({
      data: {
        organizationId: fixture.organizationId,
        amount: money('178.50'),
        issuedAt: new Date('2026-11-01'),
        reason: 'T4i trigger probe',
        customerId: fixture.customerId,
        createdById: fixture.userId,
      },
    });

  const attemptQuote = (
    loanId: string,
    fixture: Fixture,
    item: Record<string, unknown>,
    options: { legacySnapshot?: boolean } = {},
  ) => {
    const intentId = randomUUID();
    const quoteSnapshot = {
      items: [item],
      agreedCustomerTotal: '178.50',
      // The oldest generation has no sale-wide discount key at all.
      ...(options.legacySnapshot ? {} : { discountAmount: '0.00' }),
    };
    return prisma.posLoanSaleIntent.create({
      data: {
        id: intentId,
        organizationId: fixture.organizationId,
        loanId,
        customerId: fixture.customerId,
        agreedCustomerTotal: money('178.50'),
        quoteSnapshot: quoteSnapshot as Prisma.InputJsonObject,
        initiationRequestKey: nextTag().slice(0, 100),
        initiationRequestHash: 'a'.repeat(64),
        initiatedById: fixture.userId,
        initiationResult: {
          intentId,
          loanId,
          organizationId: fixture.organizationId,
          customerId: fixture.customerId,
          agreedCustomerTotal: '178.50',
          quoteSnapshot,
        } as Prisma.InputJsonObject,
      },
    });
  };

  const insertQuote = async (
    fixture: Fixture,
    item: Record<string, unknown>,
    options: { legacySnapshot?: boolean } = {},
  ) => {
    const loan = await probeLoan(fixture);
    return attemptQuote(loan.id, fixture, item, options);
  };

  /**
   * A rejected quote must leave the exact probe rows untouched: no intent for
   * that loan, no reservation hanging off it, and an OPEN loan with its amount
   * and version unchanged. Counting the whole organization or asserting a
   * non-negative count would pass even if the trigger silently accepted the
   * quote, which is the regression this guard exists for.
   */
  const expectRejectedWithoutEffects = async (
    loanId: string,
    attempt: Promise<unknown>,
    message: string,
  ) => {
    await expect(attempt).rejects.toThrow(message);
    expect(await prisma.posLoanSaleIntent.count({ where: { loanId } })).toBe(0);
    expect(
      await prisma.posLoanSaleReservation.count({
        where: { intent: { loanId } },
      }),
    ).toBe(0);
    const loan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loanId },
    });
    expect([loan.status, loan.version, loan.amount.toFixed(2)]).toEqual([
      'OPEN',
      0,
      '178.50',
    ]);
  };

  it('rejects a quote row with an unknown key and writes no intent', async () => {
    const loan = await probeLoan(active);
    await expectRejectedWithoutEffects(
      loan.id,
      attemptQuote(loan.id, active, {
        ...quoteItem(active, true),
        inventedKey: 'nope',
      }),
      'unknown keys',
    );
  });

  it.each([
    ['an unknown tribute code', { taxCode: 'BAD' }, 'is not a catalog code'],
    [
      'a numeric tribute code',
      { taxCode: 1 },
      'must be a catalog code or null',
    ],
    [
      'a tax code without a positive rate',
      { taxCode: 'IVA', taxRate: 0 },
      'requires a positive rate',
    ],
    [
      'a taxed row with a null code',
      { taxCode: null, taxRate: 19 },
      'taxed line requires a tax code',
    ],
  ])('rejects %s without writes', async (_label, patch, message) => {
    const loan = await probeLoan(active);
    await expectRejectedWithoutEffects(
      loan.id,
      attemptQuote(loan.id, active, { ...quoteItem(active, true), ...patch }),
      message,
    );
  });

  it('still accepts a pre-feature six-key quote row without a tax code', async () => {
    const intent = await insertQuote(active, quoteItem(active, false));
    const stored = intent.quoteSnapshot as { items: Record<string, unknown>[] };
    expect(Object.keys(stored.items[0]).sort()).toEqual([
      'costPriceSnapshot',
      'discountAmount',
      'productId',
      'quantity',
      'resolvedUnitPrice',
      'taxRate',
    ]);
  });

  it('still accepts the oldest four-key quote row without reclassifying it', async () => {
    const loan = await probeLoan(active);
    // The four historical keys and nothing else: this generation predates both
    // the resolved tax pair and the tribute code. One unit at exactly the agreed
    // total with no discount keeps the arithmetic exact (178.50 = 1 x 178.50 -
    // 0.00), so the accepted row cannot be read as implying a historic tax or a
    // discount this generation never carried.
    const historicalItem = {
      productId: active.productId,
      quantity: 1,
      resolvedUnitPrice: '178.50',
      discountAmount: '0.00',
    };
    const intent = await attemptQuote(loan.id, active, historicalItem, {
      legacySnapshot: true,
    });

    // Read the row back from PostgreSQL instead of trusting the returned one:
    // acceptance means the database stored it as written, not that it rewrote
    // the row into a newer generation on the way in.
    const stored = await prisma.posLoanSaleIntent.findFirstOrThrow({
      where: { id: intent.id, organizationId: active.organizationId },
    });
    const snapshot = stored.quoteSnapshot as {
      items: Record<string, unknown>[];
    };
    expect(Object.keys(snapshot).sort()).toEqual([
      'agreedCustomerTotal',
      'items',
    ]);
    expect(snapshot).toEqual({
      items: [historicalItem],
      agreedCustomerTotal: '178.50',
    });
    expect(Object.keys(snapshot.items[0]).sort()).toEqual([
      'discountAmount',
      'productId',
      'quantity',
      'resolvedUnitPrice',
    ]);
    // No reclassification: the historical generation must not gain the rate,
    // the cost or the code that the two newer generations carry.
    expect(snapshot.items[0]).not.toHaveProperty('taxCode');
    expect(snapshot.items[0]).not.toHaveProperty('taxRate');
    expect(snapshot.items[0]).not.toHaveProperty('costPriceSnapshot');
    // The initiation evidence the trigger demands (all four columns, matching
    // the intent and the scoped MONEY loan) survived unchanged, and its frozen
    // result mirrors this exact four-key snapshot rather than a newer shape.
    expect([
      stored.initiationRequestKey,
      stored.initiationRequestHash,
      stored.initiatedById,
    ]).not.toContain(null);
    expect(
      (stored.initiationResult as { quoteSnapshot: unknown }).quoteSnapshot,
    ).toEqual(snapshot);
    expect(stored.agreedCustomerTotal?.toFixed(2)).toBe('178.50');
    const storedLoan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loan.id, organizationId: active.organizationId },
    });
    expect(storedLoan.amount.toFixed(2)).toBe('178.50');
    expect([storedLoan.status, storedLoan.version]).toEqual(['OPEN', 0]);
    // Accepted, not completed: the current service has no completion path for a
    // four-key row, and this suite deliberately does not assert one. Every
    // absence check below is scoped to this test's own loan or intent, so a
    // neighbour's rows can neither satisfy nor break it.
    expect(stored.finalSaleId).toBeNull();
    expect(
      await prisma.posLoanSaleReservation.count({
        where: { intent: { loanId: loan.id } },
      }),
    ).toBe(0);
    expect(
      await prisma.sale.count({
        where: { posLoanSaleIntent: { is: { loanId: loan.id } } },
      }),
    ).toBe(0);
  });

  it('keeps rejecting non-canonical money in a tax-coded quote', async () => {
    const loan = await probeLoan(active);
    await expectRejectedWithoutEffects(
      loan.id,
      attemptQuote(loan.id, active, {
        ...quoteItem(active, true),
        resolvedUnitPrice: '80.0',
      }),
      'canonical Decimal(10,2)',
    );
  });

  it('keeps rejecting a product from another organization', async () => {
    const loan = await probeLoan(active);
    await expectRejectedWithoutEffects(
      loan.id,
      attemptQuote(loan.id, active, {
        ...quoteItem(active, true),
        productId: inactive.productId,
      }),
      'must belong to the intent organization',
    );
  });

  it('keeps the frozen quote immutable after insertion', async () => {
    const intent = await insertQuote(active, quoteItem(active, false));
    const frozen = intent.quoteSnapshot;
    await expect(
      prisma.posLoanSaleIntent.update({
        where: { id: intent.id },
        data: {
          quoteSnapshot: {
            items: [{ ...quoteItem(active, false), quantity: 3 }],
            agreedCustomerTotal: '178.50',
            discountAmount: '0.00',
          },
        },
      }),
    ).rejects.toThrow('immutable from insertion');
    // The rejected update changed nothing: the stored snapshot is still the
    // frozen one and no reservation was created beside it.
    const stored = await prisma.posLoanSaleIntent.findFirstOrThrow({
      where: { id: intent.id },
    });
    expect(stored.quoteSnapshot).toEqual(frozen);
    expect(
      await prisma.posLoanSaleReservation.count({
        where: { intentId: intent.id },
      }),
    ).toBe(0);
  });

  it('rejects a tax code on the oldest four-key generation', async () => {
    const loan = await probeLoan(active);
    await expectRejectedWithoutEffects(
      loan.id,
      attemptQuote(
        loan.id,
        active,
        {
          productId: active.productId,
          quantity: 1,
          resolvedUnitPrice: '80.00',
          discountAmount: '0.00',
          taxCode: 'IVA',
        },
        { legacySnapshot: true },
      ),
      'unknown keys',
    );
  });
});
