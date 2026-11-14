/**
 * T4i — real-PostgreSQL proof for the financed POS sale.
 *
 * The quote snapshot gained a seventh row key (`taxCode`), and the historical
 * trigger only allowed six, so every new financed quote failed with P0001
 * "unknown keys" before migration 20261106180000 replaced that validation
 * function. These tests drive the public service path against a real database:
 * quote initiation for an activated and a non-activated organization, financed
 * completion with its PENDING fiscal document (or none), and a forced fiscal
 * insert failure that must roll the whole sale back.
 *
 * The trigger's own acceptances and rejections live in
 * `loans.pos-quote-tax-code.int.spec.ts`, which needs the migration and nothing
 * else. The split exists so that migration can be reviewed and exercised on
 * committed pre-feature service state, without the fiscal model or financed
 * completion; this suite keeps the half that depends on both.
 *
 * The suite is bound to an explicitly provided isolated database and creates its
 * own uniquely named rows; it never deletes, resets or migrates anything. Run it
 * with `DATABASE_URL` pointing at a freshly migrated isolated database, e.g.
 *
 *   DATABASE_URL=postgresql://... npx jest --runInBand \
 *     src/loans/loans.pos-fiscal.int.spec.ts
 */
import { ForbiddenException } from '@nestjs/common';
import {
  DianTaxCode,
  OrgRole,
  PlanType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { SequenceService } from '../common/sequences/sequence.service';
import { LoansService } from './loans.service';

const databaseUrl = process.env.DATABASE_URL;

type Fixture = {
  organizationId: string;
  customerId: string;
  productId: string;
  userId: string;
};

describe('LoansService — financed POS fiscal integration (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let loans: LoansService;
  let tag: string;
  let active: Fixture;
  let inactive: Fixture;

  const money = (value: string) => new Prisma.Decimal(value);
  const nextTag = () => `${tag}-${randomUUID()}`;

  const actorOf = (fixture: Fixture): RequestUser => ({
    userId: fixture.userId,
    email: `${fixture.userId}@t4i.test`,
    organizationId: fixture.organizationId,
    role: OrgRole.CASHIER,
    isSuperAdmin: false,
    tokenVersion: 0,
  });

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

  const initiationDto = (fixture: Fixture) => ({
    customerId: fixture.customerId,
    requestKey: nextTag(),
    issuedAt: '2026-11-01',
    dueAt: '2026-12-01',
    reason: 'Compra financiada T4i',
    items: [{ productId: fixture.productId, quantity: 2, discountAmount: 10 }],
  });

  const collectEverything = async (fixture: Fixture, loanId: string) => {
    await loans.mutate(
      loanId,
      'COLLECTED',
      { requestKey: nextTag(), amount: 178.5, method: 'CASH' },
      fixture.userId,
      fixture.organizationId,
    );
  };

  /**
   * Real transaction, real writes, and only the fiscal insert forced to fail:
   * `fiscalDocument.create` runs last in the completion transaction, so a
   * rejection there proves the sale, its lines, the stock movement, the loan and
   * the intent link all roll back together.
   */
  const withFailingFiscalInsert = (client: PrismaClient): PrismaClient =>
    new Proxy(client, {
      get(target, property, receiver) {
        if (property === '$transaction') {
          return (
            callback: (tx: unknown) => Promise<unknown>,
            options?: unknown,
          ) =>
            target.$transaction((tx) => {
              const failing = new Proxy(tx as object, {
                get(txTarget, txProperty) {
                  const value = Reflect.get(txTarget, txProperty);
                  if (txProperty !== 'fiscalDocument') {
                    return typeof value === 'function'
                      ? value.bind(txTarget)
                      : value;
                  }
                  return new Proxy(value as object, {
                    get(delegate, delegateProperty) {
                      if (delegateProperty === 'create') {
                        return () =>
                          Promise.reject(new Error('fiscal insert failed'));
                      }
                      const inner = Reflect.get(delegate, delegateProperty);
                      return typeof inner === 'function'
                        ? inner.bind(delegate)
                        : inner;
                    },
                  });
                },
              });
              return callback(failing);
            }, options as never);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  beforeAll(() => {
    if (!databaseUrl) {
      throw new Error(
        'This suite needs DATABASE_URL pointing at a freshly migrated isolated database',
      );
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    loans = new LoansService(prisma as never, new SequenceService());
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

  it('initiates a taxed financed quote for an activated organization', async () => {
    const result = await loans.initiateFromPos(
      initiationDto(active),
      active.organizationId,
      actorOf(active),
    );

    expect(result.agreedCustomerTotal).toBe('178.50');
    const intent = await prisma.posLoanSaleIntent.findFirstOrThrow({
      where: {
        organizationId: active.organizationId,
        id: String(result.intentId),
      },
    });
    const loan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: intent.loanId, organizationId: active.organizationId },
    });
    // The agreed amount survives initiation unchanged and is the same number in
    // the loan, the intent and the frozen quote.
    expect(loan.amount.toFixed(2)).toBe('178.50');
    expect(intent.agreedCustomerTotal?.toFixed(2)).toBe('178.50');
    const items = (intent.quoteSnapshot as { items: Record<string, unknown>[] })
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ taxCode: 'IVA', taxRate: 19 });
    const reservation = await prisma.posLoanSaleReservation.findFirstOrThrow({
      where: { intentId: intent.id },
    });
    expect(reservation).toMatchObject({ state: 'HELD', quantity: 2 });
    expect(
      await prisma.fiscalDocument.count({
        where: { organizationId: active.organizationId },
      }),
    ).toBe(0);
  });

  it('initiates the same taxed quote for an organization without electronic invoicing', async () => {
    const result = await loans.initiateFromPos(
      initiationDto(inactive),
      inactive.organizationId,
      actorOf(inactive),
    );

    const intent = await prisma.posLoanSaleIntent.findFirstOrThrow({
      where: {
        organizationId: inactive.organizationId,
        id: String(result.intentId),
      },
    });
    const items = (intent.quoteSnapshot as { items: Record<string, unknown>[] })
      .items;
    expect(items[0]).toMatchObject({ taxCode: 'IVA', taxRate: 19 });
    expect(intent.agreedCustomerTotal?.toFixed(2)).toBe('178.50');
  });

  it('completes the activated sale and registers one PENDING fiscal document', async () => {
    const result = await loans.initiateFromPos(
      initiationDto(active),
      active.organizationId,
      actorOf(active),
    );
    const loanId = String(result.loanId);
    await collectEverything(active, loanId);

    const completed = await loans.completePosSale(
      loanId,
      { requestKey: nextTag() },
      active.organizationId,
      actorOf(active),
    );

    const sale = await prisma.sale.findFirstOrThrow({
      where: {
        id: String(completed.saleId),
        organizationId: active.organizationId,
      },
      include: { items: true },
    });
    expect(sale.total.toFixed(2)).toBe('178.50');
    expect(sale.subtotal.toFixed(2)).toBe('150.00');
    expect(sale.taxAmount.toFixed(2)).toBe('28.50');
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0]).toMatchObject({
      taxCode: DianTaxCode.IVA,
      taxRate: money('19.00'),
    });
    expect(sale.items[0].taxAmount?.toFixed(2)).toBe('28.50');

    const document = await prisma.fiscalDocument.findFirstOrThrow({
      where: { saleId: sale.id, organizationId: active.organizationId },
    });
    expect(document.status).toBe('PENDING');
    expect(document.cufe).toBeNull();
    expect(document.invoiceNumber).toBeNull();
    expect(document.snapshot).toMatchObject({
      lineExtensionAmount: '150.00',
      taxAmount: '28.50',
      discountAmount: '0.00',
      payableAmount: '178.50',
      lines: [expect.objectContaining({ taxCode: 'IVA', taxAmount: '28.50' })],
    });
    const intent = await prisma.posLoanSaleIntent.findFirstOrThrow({
      where: { loanId },
    });
    expect(intent.finalSaleId).toBe(sale.id);
    const loan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loanId },
    });
    expect(loan.status).toBe('CLOSED');
  });

  it('completes the inactive sale with the same money and no fiscal document', async () => {
    const result = await loans.initiateFromPos(
      initiationDto(inactive),
      inactive.organizationId,
      actorOf(inactive),
    );
    const loanId = String(result.loanId);
    await collectEverything(inactive, loanId);

    const completed = await loans.completePosSale(
      loanId,
      { requestKey: nextTag() },
      inactive.organizationId,
      actorOf(inactive),
    );

    const sale = await prisma.sale.findFirstOrThrow({
      where: {
        id: String(completed.saleId),
        organizationId: inactive.organizationId,
      },
      include: { items: true },
    });
    expect(sale.total.toFixed(2)).toBe('178.50');
    expect(sale.items[0]).toMatchObject({ taxCode: null, taxAmount: null });
    expect(
      await prisma.fiscalDocument.count({
        where: { saleId: sale.id, organizationId: inactive.organizationId },
      }),
    ).toBe(0);
  });

  it('rolls the entire completion back when the fiscal insert fails', async () => {
    const result = await loans.initiateFromPos(
      initiationDto(active),
      active.organizationId,
      actorOf(active),
    );
    const loanId = String(result.loanId);
    await collectEverything(active, loanId);
    const before = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loanId },
    });
    const stockBefore = await prisma.product.findFirstOrThrow({
      where: { id: active.productId },
    });
    const salesBefore = await prisma.sale.count({
      where: { customerId: active.customerId },
    });
    const documentsBefore = await prisma.fiscalDocument.count({
      where: { organizationId: active.organizationId },
    });

    const failing = new LoansService(
      withFailingFiscalInsert(prisma) as never,
      new SequenceService(),
    );
    await expect(
      failing.completePosSale(
        loanId,
        { requestKey: nextTag() },
        active.organizationId,
        actorOf(active),
      ),
    ).rejects.toThrow('fiscal insert failed');

    expect(
      await prisma.sale.count({ where: { customerId: active.customerId } }),
    ).toBe(salesBefore);
    expect(
      await prisma.fiscalDocument.count({
        where: { organizationId: active.organizationId },
      }),
    ).toBe(documentsBefore);
    const loan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: loanId },
    });
    expect(loan.status).toBe('OPEN');
    expect(loan.version).toBe(before.version);
    const intent = await prisma.posLoanSaleIntent.findFirstOrThrow({
      where: { loanId },
    });
    expect(intent.finalSaleId).toBeNull();
    const reservation = await prisma.posLoanSaleReservation.findFirstOrThrow({
      where: { intentId: intent.id },
    });
    expect(reservation.state).toBe('HELD');
    const product = await prisma.product.findFirstOrThrow({
      where: { id: active.productId },
    });
    expect([product.stock, product.reservedStock, product.version]).toEqual([
      stockBefore.stock,
      stockBefore.reservedStock,
      stockBefore.version,
    ]);
  });

  it('keeps refusing an inactive actor before any write', async () => {
    const before = await prisma.moneyLoan.count({
      where: { organizationId: active.organizationId },
    });
    await expect(
      loans.initiateFromPos(initiationDto(active), active.organizationId, {
        ...actorOf(active),
        role: OrgRole.INVENTORY_USER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await prisma.moneyLoan.count({
        where: { organizationId: active.organizationId },
      }),
    ).toBe(before);
  });

  it('keeps the loan amount equal to the agreed quote', async () => {
    const result = await loans.initiateFromPos(
      initiationDto(active),
      active.organizationId,
      actorOf(active),
    );
    const loan = await prisma.moneyLoan.findFirstOrThrow({
      where: { id: String(result.loanId) },
    });
    expect(loan.amount.toFixed(2)).toBe(result.agreedCustomerTotal);
    // A cross-organization actor is refused before any write.
    await expect(
      loans.initiateFromPos(
        initiationDto(inactive),
        inactive.organizationId,
        actorOf(active),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
