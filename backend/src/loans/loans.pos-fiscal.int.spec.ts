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
 *
 * CI runs the whole backend suite with parallel workers against one shared
 * database, so a foreign suite can abort this suite's Serializable transactions.
 * The two success-path operations below therefore retry the service's documented
 * concurrency 409 with the same request key, exactly as a real client must.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
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

  /**
   * CI runs the whole backend suite with parallel Jest workers against a single
   * shared database, so an unrelated suite can abort one of this suite's
   * Serializable transactions with Prisma P2034/P2002 — even though this suite
   * itself is sequential and creates only its own rows. `completePosSale` and
   * `mutate` map those codes to a 409 whose documented client contract is to
   * retry with the same request key, so the helpers below apply that contract
   * instead of failing on a conflict this suite did not cause. Only that exact
   * conflict is retried; every other failure surfaces on the first attempt.
   */
  const concurrentConflictMessage =
    'Operación concurrente; reintente con la misma clave de solicitud';
  const concurrentAttempts = 3;

  const isConcurrentConflict = (error: unknown): boolean =>
    error instanceof ConflictException &&
    error.message === concurrentConflictMessage;

  const retryingConcurrency = async <T>(run: () => Promise<T>): Promise<T> => {
    let lastConflict: unknown;
    for (let attempt = 1; attempt <= concurrentAttempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (!isConcurrentConflict(error)) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict;
  };

  const actorOf = (fixture: Fixture): RequestUser => ({
    userId: fixture.userId,
    email: `${fixture.userId}@t4i.test`,
    organizationId: fixture.organizationId,
    role: OrgRole.CASHIER,
    isSuperAdmin: false,
    tokenVersion: 0,
  });

  /**
   * Completion is the financed sale's single Serializable write, so a foreign
   * suite's interference reaches this suite as the documented 409. The request
   * key is minted once and reused by every attempt, which is what the service
   * asks of a client: replays are recognised by that key, not by a new one. The
   * `service` parameter defaults to the real one and exists only so the retry
   * contract can be proved against a stub.
   */
  const completeWithRetry = (
    loanId: string,
    requestKey: string,
    fixture: Fixture,
    service: LoansService = loans,
  ) =>
    retryingConcurrency(() =>
      service.completePosSale(
        loanId,
        { requestKey },
        fixture.organizationId,
        actorOf(fixture),
      ),
    );

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

  it('preserves one authorized origin from hold through explicit completion and cancellation', async () => {
    const fixture = await makeFixture('origin', {});
    const { organizationId, userId, productId } = fixture;
    const actor = actorOf(fixture);
    const principal = await prisma.location.create({
      data: { organizationId, name: 'Principal', isDefault: true },
    });
    const foreign = await prisma.location.create({
      data: { organizationId: active.organizationId, name: 'Foreign site' },
    });
    const grant = { userId, organizationId, locationId: principal.id };
    await prisma.membershipLocation.create({ data: grant });
    const snapshot = async () => {
      const where = { organizationId };
      return {
        loans: await prisma.moneyLoan.count({ where }),
        events: await prisma.moneyLoanEvent.count({ where }),
        sales: await prisma.sale.count({ where }),
        origins: await prisma.posLoanSaleIntentOriginSite.count({ where }),
        saleOrigins: await prisma.saleOriginSite.count({ where }),
        movements: await prisma.inventoryMovement.count({ where }),
        siteBalances: await prisma.productStock.count({ where }),
        product: await prisma.product.findUniqueOrThrow({
          where: { id: productId },
          select: { stock: true, reservedStock: true },
        }),
      };
    };
    const dto = { ...initiationDto(fixture), locationId: principal.id };
    const initiate = (input: typeof dto) =>
      loans.initiateFromPos(input, organizationId, actor);
    const before = await snapshot();
    await expect(initiate({ ...dto, locationId: foreign.id })).rejects.toMatchObject({
      status: 404, message: 'Location not found',
    });
    expect(await snapshot()).toEqual(before);
    const finance = await initiate(dto);
    const toCancel = await initiate({ ...dto, requestKey: nextTag() });
    expect(finance).not.toHaveProperty('locationId');
    expect(await prisma.posLoanSaleIntentOriginSite.findMany({
      where: { organizationId }, select: { locationId: true },
    })).toEqual([{ locationId: principal.id }, { locationId: principal.id }]);
    const held = await snapshot();
    expect(held.product).toEqual({ stock: 10, reservedStock: 4 });
    expect(held.siteBalances).toBe(0);
    const { locationId: _locationId, ...omitted } = dto;
    await expect(initiate(dto)).resolves.toEqual(finance);
    await expect(loans.initiateFromPos(omitted, organizationId, actor)).resolves.toEqual(finance);
    const second = await prisma.location.create({ data: { organizationId, name: 'Second site' } });
    await expect(initiate({ ...dto, locationId: second.id })).rejects.toMatchObject({ status: 409 });
    await expect(initiate({ ...dto, requestKey: nextTag() })).rejects.toMatchObject({
      status: 409, message: 'El stock global solo permite ventas en la única sede principal',
    });
    expect(await snapshot()).toEqual(held);

    const loanId = finance.loanId as string;
    const completion = { requestKey: nextTag() };
    const finish = () => loans.completePosSale(loanId, completion, organizationId, actor);
    await prisma.membershipLocation.deleteMany({ where: grant });
    await collectEverything(fixture, loanId);
    const paid = await snapshot();
    expect(paid).toEqual({ ...held, events: held.events + 1 });
    await expect(finish()).rejects.toMatchObject({ status: 404, message: 'Location not found' });
    expect(await snapshot()).toEqual(paid);

    await prisma.membershipLocation.create({ data: grant });
    const result = await finish();
    const saleId = result.saleId as string;
    expect(result.status).toBe('CLOSED');
    expect(await prisma.saleOriginSite.findFirstOrThrow({ where: { saleId } })).toEqual({
      saleId, organizationId, locationId: principal.id,
    });
    expect(await prisma.inventoryMovement.findFirstOrThrow({
      where: { saleId }, select: { type: true, quantity: true, locationId: true },
    })).toEqual({ type: 'SALE', quantity: -2, locationId: principal.id });
    const completed = await snapshot();
    expect(completed.product).toEqual({ stock: 8, reservedStock: 2 });
    await expect(finish()).resolves.toEqual(result);
    expect(await snapshot()).toEqual(completed);

    const cancelBody = { requestKey: nextTag(), reason: 'Cancelar sin abonos' };
    const admin = { ...actor, role: OrgRole.ADMIN };
    const cancel = () => loans.mutate(
      toCancel.loanId as string, 'CANCELLED', cancelBody, userId, organizationId, admin,
    );
    await expect(cancel()).rejects.toMatchObject({ status: 403, message: 'Location authorization changed' });
    expect(await snapshot()).toEqual(completed);
    await prisma.organizationUser.updateMany({ where: { userId, organizationId }, data: { role: OrgRole.ADMIN } });
    await expect(cancel()).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(await snapshot()).toEqual({ ...completed, events: completed.events + 1, product: { stock: 8, reservedStock: 0 } });
    const reservations = await prisma.posLoanSaleReservation.findMany({
      where: { organizationId }, select: { intentId: true, state: true },
    });
    expect(reservations).toEqual(expect.arrayContaining([
      { intentId: finance.intentId, state: 'CONSUMED' },
      { intentId: toCancel.intentId, state: 'RELEASED' },
    ]));
  });

  const initiationDto = (fixture: Fixture) => ({
    customerId: fixture.customerId,
    requestKey: nextTag(),
    issuedAt: '2026-11-01',
    dueAt: '2026-12-01',
    reason: 'Compra financiada T4i',
    items: [{ productId: fixture.productId, quantity: 2, discountAmount: 10 }],
  });

  const collectEverything = async (fixture: Fixture, loanId: string) => {
    // `mutate` maps the same Serializable conflict to the same 409, so the key is
    // minted once and reused by every attempt.
    const requestKey = nextTag();
    await retryingConcurrency(() =>
      loans.mutate(
        loanId,
        'COLLECTED',
        { requestKey, amount: 178.5, method: 'CASH' },
        fixture.userId,
        fixture.organizationId,
      ),
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

    const completed = await completeWithRetry(loanId, nextTag(), active);

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

    const completed = await completeWithRetry(loanId, nextTag(), inactive);

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

  /**
   * A real serialization race cannot be scheduled deterministically, so the
   * retry contract above is proved against a stubbed completion: the conflict is
   * raised exactly where `completePosSale` would raise it, and the helper's own
   * observable effects (attempt count, key reuse, what it rethrows) are asserted
   * through its public call, without touching the database.
   */
  it('retries the concurrent conflict with the same request key and returns the result', async () => {
    const conflict = new ConflictException(concurrentConflictMessage);
    const completePosSale = jest
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ saleId: 'sale-on-third-attempt' });
    const service = { completePosSale } as unknown as LoansService;

    const completed = await completeWithRetry(
      'loan-retry',
      'retried-key',
      active,
      service,
    );

    expect(completed).toEqual({ saleId: 'sale-on-third-attempt' });
    expect(completePosSale).toHaveBeenCalledTimes(3);
    expect(
      completePosSale.mock.calls.map(
        ([, dto]) => (dto as { requestKey: string }).requestKey,
      ),
    ).toEqual(['retried-key', 'retried-key', 'retried-key']);
  });

  it('rethrows the last conflict once the three attempts are exhausted', async () => {
    const conflicts = [1, 2, 3].map(
      () => new ConflictException(concurrentConflictMessage),
    );
    const completePosSale = jest
      .fn()
      .mockRejectedValueOnce(conflicts[0])
      .mockRejectedValueOnce(conflicts[1])
      .mockRejectedValueOnce(conflicts[2]);
    const service = { completePosSale } as unknown as LoansService;

    await expect(
      completeWithRetry('loan-exhausted', 'exhausted-key', active, service),
    ).rejects.toBe(conflicts[2]);
    expect(completePosSale).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-conflict failure on the first attempt', async () => {
    const failure = new BadRequestException(
      'Solicitud de finalización inválida',
    );
    const completePosSale = jest.fn().mockRejectedValue(failure);
    const service = { completePosSale } as unknown as LoansService;

    await expect(
      completeWithRetry('loan-failing', 'no-retry-key', active, service),
    ).rejects.toBe(failure);
    expect(completePosSale).toHaveBeenCalledTimes(1);
  });
});
