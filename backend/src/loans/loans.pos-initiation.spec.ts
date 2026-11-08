import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  RequestMethod,
} from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { LoansController } from './loans.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePosLoanDto } from './dto/create-pos-loan.dto';
import { LoansService } from './loans.service';

const actor = (role: RequestUser['role'] = 'CASHIER'): RequestUser => ({
  userId: 'actor',
  email: 'actor@example.test',
  organizationId: 'org',
  role,
  isSuperAdmin: role === 'SUPER_ADMIN',
  tokenVersion: 0,
});
const request = (
  changes: Partial<CreatePosLoanDto> = {},
): CreatePosLoanDto => ({
  customerId: 'c1419db5-591b-4ba6-a926-846d95628ad6',
  requestKey: 'pos-key',
  issuedAt: '2026-10-13',
  dueAt: '2026-11-13',
  reason: 'Compra financiada',
  items: [{ productId: 'coffee', quantity: 2, discountAmount: 10 }],
  ...changes,
});
const product = (id = 'coffee') => ({
  id,
  organizationId: 'org',
  name: 'Coffee',
  active: true,
  type: 'PRODUCT',
  tracksStock: true,
  stock: 12,
  reservedStock: 3,
  version: 7,
  costPrice: new Prisma.Decimal(40),
  salePrice: new Prisma.Decimal(100),
  promotionType: 'PERCENTAGE',
  promotionValue: new Prisma.Decimal(20),
  taxable: true,
  taxRate: new Prisma.Decimal(19),
  category: { taxable: true, defaultTaxRate: new Prisma.Decimal(10) },
});
type Row = Record<string, unknown>;
type Event = Row & {
  id: string;
  type: string;
  amount: Prisma.Decimal | null;
  reversesId: string | null;
};
const initialLoan = () => ({
  id: 'loan',
  organizationId: 'org',
  type: 'MONEY',
  status: 'OPEN',
  version: 0,
  customerId: request().customerId,
  supplierId: null,
  employeeId: null,
  createdById: 'actor',
  amount: new Prisma.Decimal('178.50'),
  events: [] as Event[],
});
type State = {
  loan: ReturnType<typeof initialLoan>;
  products: ReturnType<typeof product>[];
  intents: Row[];
  holds: Row[];
  audits: Row[];
  customers: {
    id: string;
    organizationId: string;
    active: boolean;
    documentNumber?: string | null;
  }[];
};
// Only the scalar predicates used by this unit are modeled; unknown operators fail.
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, value]) => {
    if (value && typeof value === 'object') {
      const condition = value as Row;
      if ('in' in condition)
        return (condition.in as unknown[]).includes(row[field]);
      if ('gte' in condition)
        return Number(row[field]) >= Number(condition.gte);
      if (field === 'organizationId_initiationRequestKey')
        return matches(row, condition);
      return false;
    }
    return row[field] === value;
  });
}
function fixture() {
  let committed: State = {
    loan: initialLoan(),
    products: [product()],
    intents: [],
    holds: [],
    audits: [],
    customers: [
      {
        id: request().customerId,
        organizationId: 'org',
        active: true,
        documentNumber: '900.111.222-3',
      },
    ],
  };
  // Spec S9: the financed sale honours the same activation decision as a cash
  // sale, so the fixture owns one organization row the tests can switch.
  const organization = {
    id: 'org',
    taxId: '900123456',
    settings: { electronicInvoicing: { enabled: true } } as Record<
      string,
      unknown
    >,
  };
  let pending = committed;
  let visibleWinner: Row | null = null;
  const tx = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'actor', active: true }),
    },
    organizationUser: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ userId: 'actor', role: 'CASHIER' }),
    },
    customer: {
      findFirst: jest.fn(
        async ({ where }: { where: Row }) =>
          pending.customers.find((row) => matches(row, where)) ?? null,
      ),
    },
    product: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        pending.products.filter((row) => matches(row, where)),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Row }) =>
          pending.products.find((row) => matches(row, where)) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Row;
          data: {
            reservedStock: { increment?: number; decrement?: number };
            stock?: { decrement: number };
            version: { increment: number };
          };
        }) => {
          const rows = pending.products.filter((row) => matches(row, where));
          for (const row of rows) {
            row.reservedStock +=
              (data.reservedStock.increment ?? 0) -
              (data.reservedStock.decrement ?? 0);
            row.stock -= data.stock?.decrement ?? 0;
            row.version += data.version.increment;
          }
          return { count: rows.length };
        },
      ),
    },
    moneyLoan: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        pending.loan = { ...pending.loan, ...data };
        return pending.loan;
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) =>
        matches(pending.loan, where) ? pending.loan : null,
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: Row; data: { status: string } }) => {
          if (!matches(pending.loan, where)) return { count: 0 };
          pending.loan = {
            ...pending.loan,
            status: data.status,
            version: pending.loan.version + 1,
          };
          return { count: 1 };
        },
      ),
    },
    moneyLoanEvent: {
      findFirst: jest.fn(
        async ({ where }: { where: Row }) =>
          pending.loan.events.find((event) => matches(event, where)) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const event = {
          amount: null,
          reversesId: null,
          ...data,
          id: `event-${pending.loan.events.length}`,
          type: String(data.type),
        };
        pending.loan.events.push(event);
        return event;
      }),
    },
    posLoanSaleIntent: {
      findFirst: jest.fn(
        async ({ where }: { where: Row }) =>
          pending.intents.find((row) => matches(row, where)) ?? null,
      ),
      findUnique: jest.fn(
        async ({ where }: { where: Row }) =>
          pending.intents.find((row) => matches(row, where)) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: 'intent', finalSaleId: null, ...data };
        pending.intents.push(row);
        return row;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Row; data: Row }) => {
          const rows = pending.intents.filter((row) => matches(row, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      ),
    },
    posLoanSaleReservation: {
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        pending.holds.filter((row) => matches(row, where)),
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `hold-${String(data.productId)}`,
          state: 'HELD',
          ...data,
        };
        pending.holds.push(row);
        return row;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Row; data: Row }) => {
          const rows = pending.holds.filter((row) => matches(row, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      ),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        pending.audits.push(data);
        return data;
      }),
    },
    sale: {
      create: jest.fn().mockResolvedValue({
        id: 'sale',
        createdAt: new Date('2026-11-04T15:20:31.000Z'),
      }),
    },
    saleItem: { create: jest.fn() },
    organization: {
      findFirst: jest.fn(() => Promise.resolve(organization)),
    },
    fiscalDocument: {
      create: jest.fn(({ data }: { data: Row }) => Promise.resolve(data)),
    },
    payment: { create: jest.fn() },
    inventoryMovement: { create: jest.fn() },
  };
  // Root reads model post-abort winner visibility; every write must use the callback.
  const outsideWrite = jest.fn(() => {
    throw new Error('Write outside transaction');
  });
  const readIntent = jest.fn(
    async ({ where }: { where: Row }) =>
      [...committed.intents, ...(visibleWinner ? [visibleWinner] : [])].find(
        (row) => matches(row, where),
      ) ?? null,
  );
  // This is local callback atomicity simulation, not Prisma rollback or SSI proof.
  const prisma = {
    ...tx,
    moneyLoan: {
      ...tx.moneyLoan,
      create: outsideWrite,
      updateMany: outsideWrite,
    },
    moneyLoanEvent: { ...tx.moneyLoanEvent, create: outsideWrite },
    product: { ...tx.product, updateMany: outsideWrite },
    posLoanSaleIntent: {
      findFirst: readIntent,
      findUnique: readIntent,
      create: outsideWrite,
      updateMany: outsideWrite,
    },
    posLoanSaleReservation: {
      ...tx.posLoanSaleReservation,
      create: outsideWrite,
      updateMany: outsideWrite,
    },
    auditLog: { create: outsideWrite },
    sale: { create: outsideWrite },
    saleItem: { create: outsideWrite },
    organization: outsideWrite,
    fiscalDocument: { ...tx.fiscalDocument, create: outsideWrite },
    inventoryMovement: { create: outsideWrite },
    $transaction: jest.fn(
      async (fn: (client: typeof tx) => Promise<unknown>) => {
        pending = {
          ...committed,
          loan: { ...committed.loan, events: [...committed.loan.events] },
          products: committed.products.map((row) => ({ ...row })),
          intents: committed.intents.map((row) => ({ ...row })),
          holds: committed.holds.map((row) => ({ ...row })),
          audits: committed.audits.map((row) => ({ ...row })),
          customers: committed.customers.map((row) => ({ ...row })),
        };
        try {
          const result = await fn(tx);
          committed = pending;
          return result;
        } finally {
          pending = committed;
        }
      },
    ),
  };
  const sequence = {
    nextNumber: jest.fn().mockResolvedValue({ number: 42, formatted: '42' }),
  };
  const service = new LoansService(
    prisma as unknown as PrismaService,
    sequence as never,
  );
  const initiate = (
    dto = request(),
    user: RequestUser | undefined = actor(),
    org: string | undefined = 'org',
  ) => service.initiateFromPos(dto, org, user);
  const cancel = () =>
    service.mutate(
      'loan',
      'CANCELLED',
      { requestKey: 'cancel-key', reason: 'Desistió' },
      'actor',
      'org',
    );
  return {
    tx,
    prisma,
    service,
    sequence,
    organization,
    complete: (requestKey = 'complete-key', user = actor()) =>
      service.completePosSale('loan', { requestKey }, 'org', user),
    collect: (
      amount = Number(committed.loan.amount),
      requestKey = 'collection-key',
    ) =>
      service.mutate(
        'loan',
        'COLLECTED',
        { requestKey, amount, method: 'CASH' },
        'actor',
        'org',
      ),
    initiate,
    cancel,
    outsideWrite,
    state: () => committed,
    exposeWinner: (row: Row) => {
      visibleWinner = row;
    },
  };
}
function noSaleEffects(tx: ReturnType<typeof fixture>['tx']) {
  expect(tx.sale.create).not.toHaveBeenCalled();
  expect(tx.payment.create).not.toHaveBeenCalled();
  expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
}
function noNewWrites(tx: ReturnType<typeof fixture>['tx']) {
  for (const write of [
    tx.moneyLoan.create,
    tx.moneyLoanEvent.create,
    tx.auditLog.create,
    tx.product.updateMany,
    tx.posLoanSaleIntent.create,
    tx.posLoanSaleReservation.create,
  ]) {
    expect(write).not.toHaveBeenCalled();
  }
}

describe('POS financing through LoansService (unwired)', () => {
  it('persists one canonical MONEY debt, frozen quote, actor history and owned reservation', async () => {
    const f = fixture();
    const result = await f.initiate();
    expect(result).toEqual({
      intentId: expect.any(String),
      loanId: 'loan',
      organizationId: 'org',
      customerId: request().customerId,
      agreedCustomerTotal: '178.50',
      quoteSnapshot: {
        agreedCustomerTotal: '178.50',
        discountAmount: '0.00',
        items: [
          {
            productId: 'coffee',
            quantity: 2,
            resolvedUnitPrice: '80.00',
            discountAmount: '10.00',
            taxRate: 19,
            taxCode: 'IVA',
            costPriceSnapshot: '40.00',
          },
        ],
      },
    });
    const loanData = f.tx.moneyLoan.create.mock.calls[0][0].data;
    const intentData = f.tx.posLoanSaleIntent.create.mock.calls[0][0].data;
    expect(loanData).toMatchObject({
      type: 'MONEY',
      customerId: request().customerId,
      createdById: 'actor',
      organizationId: 'org',
    });
    expect(loanData.amount).toBe(intentData.agreedCustomerTotal);
    expect((loanData.amount as Prisma.Decimal).toFixed(2)).toBe('178.50');
    expect(intentData).toMatchObject({
      id: result.intentId,
      initiationRequestKey: 'pos-key',
      initiatedById: 'actor',
      initiationRequestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      initiationResult: result,
      quoteSnapshot: result.quoteSnapshot,
    });
    expect(f.tx.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: request().customerId,
          organizationId: 'org',
          active: true,
        },
      }),
    );
    expect(f.tx.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org', active: true }),
      }),
    );
    expect(f.tx.moneyLoanEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loanId: 'loan',
          organizationId: 'org',
          createdById: 'actor',
          type: 'CREATED',
        }),
      }),
    );
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'LOAN_CREATED',
          resource: 'MoneyLoan',
          resourceId: 'loan',
          userId: 'actor',
        }),
      }),
    );
    expect(f.tx.posLoanSaleReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          intentId: result.intentId,
          organizationId: 'org',
          productId: 'coffee',
          quantity: 2,
        }),
      }),
    );
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    const lookups = [
      ...f.tx.posLoanSaleIntent.findFirst.mock.calls,
      ...f.tx.posLoanSaleIntent.findUnique.mock.calls,
    ];
    expect(lookups.some(([call]) => matches(intentData, call.where))).toBe(
      true,
    );
    const lookupOrder = [
      ...f.tx.posLoanSaleIntent.findFirst.mock.invocationCallOrder,
      ...f.tx.posLoanSaleIntent.findUnique.mock.invocationCallOrder,
    ];
    expect(Math.min(...lookupOrder)).toBeLessThan(
      f.tx.customer.findFirst.mock.invocationCallOrder[0],
    );
    expect(f.outsideWrite).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    noSaleEffects(f.tx);
  });

  it('replays original evidence before live reads, even after cancellation and catalog changes', async () => {
    const f = fixture();
    const original = await f.initiate();
    f.state().loan.status = 'CANCELLED';
    f.state().products[0].salePrice = new Prisma.Decimal(999);
    f.state().customers[0].active = false;
    for (const mock of [
      f.tx.customer.findFirst,
      f.tx.product.findMany,
      f.tx.product.findFirst,
      f.tx.moneyLoan.create,
      f.tx.moneyLoanEvent.create,
      f.tx.auditLog.create,
      f.tx.product.updateMany,
      f.tx.posLoanSaleIntent.create,
      f.tx.posLoanSaleReservation.create,
    ])
      mock.mockClear();
    expect(await f.initiate()).toEqual(original);
    expect(f.tx.customer.findFirst).not.toHaveBeenCalled();
    expect(f.tx.product.findMany).not.toHaveBeenCalled();
    expect(f.tx.product.findFirst).not.toHaveBeenCalled();
    noNewWrites(f.tx);
  });

  it('canonicalizes equivalent requested fields without hashing live catalog or object key order', async () => {
    const f = fixture();
    const original = await f.initiate();
    const before = f.state();
    const equivalent = request({
      reason: '  Compra financiada  ',
      items: [{ discountAmount: 10, quantity: 2, productId: 'coffee' }],
    });
    expect(await f.initiate(equivalent)).toEqual(original);
    expect(f.state()).toEqual(before);
    expect(f.tx.moneyLoan.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { target: ['organizationId', 'initiationRequestKey'] },
    { target: 'PosLoanSaleIntent_organizationId_initiationRequestKey_key' },
  ])(
    'reconciles only the initiation-key unique loser (%j) against an already visible winner',
    async ({ target }) => {
      const winner = fixture();
      const original = await winner.initiate();
      const loser = fixture();
      const before = loser.state();
      loser.exposeWinner(winner.state().intents[0]);
      loser.tx.posLoanSaleIntent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique initiation key', {
          code: 'P2002',
          clientVersion: '6.19.2',
          meta: { modelName: 'PosLoanSaleIntent', target },
        }),
      );
      expect(await loser.initiate()).toEqual(original);
      expect(loser.state()).toEqual(before);
      expect(loser.outsideWrite).not.toHaveBeenCalled();
      expect(loser.prisma.$transaction).toHaveBeenCalledTimes(1);
      // This models post-abort evidence visibility, not a PostgreSQL race.
    },
  );

  it('does not turn an unrelated unique failure into an initiation replay', async () => {
    const f = fixture();
    const before = f.state();
    const unrelated = new Prisma.PrismaClientKnownRequestError(
      'unrelated unique',
      {
        code: 'P2002',
        clientVersion: '6.19.2',
        meta: { modelName: 'MoneyLoan', target: ['id'] },
      },
    );
    f.tx.moneyLoan.create.mockRejectedValue(unrelated);
    await expect(f.initiate()).rejects.toBe(unrelated);
    expect(f.state()).toEqual(before);
    expect(f.prisma.posLoanSaleIntent.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.posLoanSaleIntent.findUnique).not.toHaveBeenCalled();
  });

  it.each(['actor', 'hash'])(
    'rejects a unique-loser winner with a different %s',
    async (field) => {
      const winner = fixture();
      await winner.initiate();
      const row = { ...winner.state().intents[0] };
      if (field === 'actor') row.initiatedById = 'other-actor';
      else row.initiationRequestHash = '0'.repeat(64);
      const f = fixture();
      const before = f.state();
      f.exposeWinner(row);
      f.tx.posLoanSaleIntent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique initiation key', {
          code: 'P2002',
          clientVersion: '6.19.2',
          meta: {
            modelName: 'PosLoanSaleIntent',
            target: ['organizationId', 'initiationRequestKey'],
          },
        }),
      );
      await expect(f.initiate()).rejects.toThrow(ConflictException);
      expect(f.state()).toEqual(before);
    },
  );

  it.each([
    'customer',
    'reason',
    'date',
    'quantity',
    'price',
    'discount',
    'actor',
  ])('conflicts on changed %s under the same key', async (change) => {
    const f = fixture();
    await f.initiate();
    const dto = request();
    const user = actor();
    if (change === 'customer') dto.customerId = 'other';
    if (change === 'reason') dto.reason = 'Otra compra';
    if (change === 'date') dto.dueAt = '2026-12-13';
    if (change === 'quantity') dto.items[0].quantity = 3;
    if (change === 'price') dto.items[0].unitPrice = 60;
    if (change === 'discount') dto.items[0].discountAmount = 5;
    if (change === 'actor') user.userId = 'other-actor';
    await expect(f.initiate(dto, user)).rejects.toThrow(ConflictException);
    expect(f.state().intents).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
  });

  it.each(['OWNER', 'ADMIN', 'CASHIER', 'MEMBER', 'SUPER_ADMIN'] as const)(
    'permits %s financing; global SUPER_ADMIN needs no membership',
    async (role) => {
      const f = fixture();
      const principal = actor(role);
      if (role === 'SUPER_ADMIN') {
        f.tx.organizationUser.findFirst.mockResolvedValue(null);
        principal.organizationId = undefined;
      }
      await expect(f.initiate(request(), principal)).resolves.toMatchObject({
        loanId: 'loan',
      });
    },
  );
  it.each(['inventory', 'missing', 'scope', 'foreign'])(
    'denies %s actor/scope before effects',
    async (kind) => {
      const f = fixture();
      const user =
        kind === 'missing'
          ? undefined
          : actor(kind === 'inventory' ? 'INVENTORY_USER' : 'CASHIER');
      if (kind === 'foreign' && user) user.organizationId = 'foreign-org';
      // Explicit call avoids a default argument replacing a missing principal/scope.
      await expect(
        f.service.initiateFromPos(
          request(),
          kind === 'scope' ? undefined : 'org',
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
      noNewWrites(f.tx);
    },
  );
  it.each(['inactive', 'foreign', 'missing'])(
    'rejects %s customer from the scoped active lookup',
    async (kind) => {
      const f = fixture();
      if (kind === 'inactive') f.state().customers[0].active = false;
      if (kind === 'foreign')
        f.state().customers[0].organizationId = 'foreign-org';
      if (kind === 'missing') f.state().customers = [];
      await expect(f.initiate()).rejects.toThrow(BadRequestException);
      noNewWrites(f.tx);
    },
  );

  it.each(['OWNER', 'ADMIN', 'CASHIER', 'SUPER_ADMIN'] as const)(
    'audits %s upward and downward price overrides against the actual loan',
    async (role) => {
      for (const price of [60, 120]) {
        const f = fixture();
        const result = await f.initiate(
          request({
            items: [{ productId: 'coffee', quantity: 2, unitPrice: price }],
          }),
          actor(role),
        );
        expect(result.agreedCustomerTotal).toBe(
          price === 60 ? '142.80' : '285.60',
        );
        const override = f
          .state()
          .audits.find((row) => row.action === 'SALE_PRICE_OVERRIDE');
        expect(override).toMatchObject({
          userId: 'actor',
          organizationId: 'org',
          resourceId: 'loan',
        });
        expect(JSON.stringify(override)).toContain('intent');
        expect(JSON.stringify(override)).not.toContain('saleNumber');
        noSaleEffects(f.tx);
      }
    },
  );
  it.each(['MEMBER', 'INVENTORY_USER'] as const)(
    'denies %s manual pricing',
    async (role) => {
      const f = fixture();
      await expect(
        f.initiate(
          request({
            items: [{ productId: 'coffee', quantity: 1, unitPrice: 120 }],
          }),
          actor(role),
        ),
      ).rejects.toThrow(ForbiddenException);
      noNewWrites(f.tx);
    },
  );

  it('aggregates duplicate physical lines and pins the complete reservation-only CAS', async () => {
    const f = fixture();
    await f.initiate(
      request({
        items: [
          { productId: 'coffee', quantity: 2 },
          { productId: 'coffee', quantity: 3 },
        ],
      }),
    );
    expect(f.tx.product.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'coffee',
        organizationId: 'org',
        active: true,
        type: 'PRODUCT',
        tracksStock: true,
        version: 7,
        stock: 12,
        reservedStock: 3,
      },
      data: { reservedStock: { increment: 5 }, version: { increment: 1 } },
    });
    expect(f.state().holds).toHaveLength(1);
    expect(f.state().holds[0].quantity).toBe(5);
    expect(f.state().products[0]).toMatchObject({
      stock: 12,
      reservedStock: 8,
      version: 8,
    });
    expect(f.outsideWrite).not.toHaveBeenCalled();
    noSaleEffects(f.tx);
  });
  it.each([10, 0.5, 2147483648])(
    'rejects unavailable/noninteger/overflow quantity %s',
    async (quantity) => {
      const f = fixture();
      await expect(
        f.initiate(request({ items: [{ productId: 'coffee', quantity }] })),
      ).rejects.toThrow(
        quantity === 10 ? ConflictException : BadRequestException,
      );
      expect(f.state().intents).toHaveLength(0);
      expect(f.state().holds).toHaveLength(0);
    },
  );
  it.each(['SERVICE', 'untracked'])(
    'creates MONEY for %s without physical holds',
    async (kind) => {
      const f = fixture();
      if (kind === 'SERVICE') f.state().products[0].type = 'SERVICE';
      else f.state().products[0].tracksStock = false;
      await f.initiate();
      expect(f.state().loan.type).toBe('MONEY');
      expect(f.tx.product.updateMany).not.toHaveBeenCalled();
      expect(f.tx.posLoanSaleReservation.create).not.toHaveBeenCalled();
      noSaleEffects(f.tx);
    },
  );

  it.each(['CAS', 'intent', 'event', 'audit'])(
    'aborts local staged effects when %s fails',
    async (stage) => {
      const f = fixture();
      const failure = new Error(`failure-${stage}`);
      const before = f.state();
      if (stage === 'CAS')
        f.tx.product.updateMany.mockResolvedValue({ count: 0 });
      if (stage === 'intent')
        f.tx.posLoanSaleIntent.create.mockRejectedValue(failure);
      if (stage === 'event')
        f.tx.moneyLoanEvent.create.mockRejectedValue(failure);
      if (stage === 'audit') f.tx.auditLog.create.mockRejectedValue(failure);
      await expect(f.initiate()).rejects.toThrow(
        stage === 'CAS' ? ConflictException : failure,
      );
      expect(f.state().intents).toEqual([]);
      expect(f.state().holds).toEqual([]);
      expect(f.state().loan.events).toEqual([]);
      expect(f.state().audits).toEqual([]);
      expect(f.state()).toEqual(before);
      expect(f.outsideWrite).not.toHaveBeenCalled();
    },
  );

  it('cancels unpaid financing, claims CANCELLED first, releases only owned HELD rows once', async () => {
    const f = fixture();
    const initiated = await f.initiate();
    f.state().holds.push({
      id: 'foreign',
      intentId: 'other-intent',
      state: 'HELD',
      organizationId: 'org',
      productId: 'coffee',
      quantity: 8,
    });
    f.state().holds.push({
      id: 'foreign-tenant',
      intentId: initiated.intentId,
      organizationId: 'other',
      productId: 'coffee',
      state: 'HELD',
      quantity: 9,
    });
    f.state().holds.push({
      id: 'terminal',
      intentId: initiated.intentId,
      organizationId: 'org',
      productId: 'old-product',
      state: 'CONSUMED',
      quantity: 1,
    });
    f.state().products[0].active = false;
    f.state().products[0].type = 'SERVICE';
    f.tx.product.updateMany.mockClear();
    const result = await f.cancel();
    expect(result).toMatchObject({ status: 'CANCELLED', collected: '0.00' });
    expect(f.tx.moneyLoan.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'loan',
        organizationId: 'org',
        status: 'OPEN',
        version: 0,
      },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    expect(f.tx.product.updateMany).toHaveBeenCalledTimes(1);
    const release = f.tx.product.updateMany.mock.calls[0][0];
    expect(release).toMatchObject({
      where: { id: 'coffee', organizationId: 'org' },
      data: { reservedStock: { decrement: 2 }, version: { increment: 1 } },
    });
    expect(release.where).not.toHaveProperty('active');
    expect(release.where).not.toHaveProperty('type');
    expect(release.data).not.toHaveProperty('stock');
    expect(f.tx.posLoanSaleReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          intentId: initiated.intentId,
          organizationId: 'org',
          state: 'HELD',
        }),
        data: expect.objectContaining({
          state: 'RELEASED',
          finalizedById: 'actor',
          finalizedAt: expect.any(Date),
        }),
      }),
    );
    expect(f.tx.moneyLoan.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.posLoanSaleReservation.updateMany.mock.invocationCallOrder[0],
    );
    expect(f.state().products[0]).toMatchObject({
      stock: 12,
      reservedStock: 3,
      version: 9,
    });
    expect(f.state().holds[0]).toMatchObject({
      state: 'RELEASED',
      finalizedById: 'actor',
      finalizedAt: expect.any(Date),
    });
    expect(
      f
        .state()
        .holds.slice(1)
        .map((row) => row.state),
    ).toEqual(['HELD', 'HELD', 'CONSUMED']);
    const after = f.state();
    await expect(f.cancel()).resolves.toEqual(result);
    expect(f.state()).toEqual(after);
    expect(f.outsideWrite).not.toHaveBeenCalled();
    expect(f.tx.product.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.posLoanSaleReservation.updateMany).toHaveBeenCalledTimes(1);
    noSaleEffects(f.tx);
  });
  it('sorts multiple physical holds and cancellation releases by product ID', async () => {
    const f = fixture();
    f.state().products = [product('z-product'), product('a-product')];
    await f.initiate(
      request({
        items: [
          { productId: 'z-product', quantity: 2 },
          { productId: 'a-product', quantity: 1 },
        ],
      }),
    );
    expect(
      f.tx.product.updateMany.mock.calls.map(([call]) => call.where.id),
    ).toEqual(['a-product', 'z-product']);
    expect(f.state().holds.map((row) => row.productId)).toEqual([
      'a-product',
      'z-product',
    ]);
    f.tx.product.updateMany.mockClear();
    await f.cancel();
    expect(
      f.tx.product.updateMany.mock.calls.map(([call]) => call.where.id),
    ).toEqual(['a-product', 'z-product']);
    expect(
      f
        .state()
        .products.map((row) => [row.stock, row.reservedStock, row.version]),
    ).toEqual([
      [12, 3, 9],
      [12, 3, 9],
    ]);
    expect(f.state().holds.every((row) => row.state === 'RELEASED')).toBe(true);
    expect(f.outsideWrite).not.toHaveBeenCalled();
  });

  it.each(['loan-CAS', 'second-counter', 'claim', 'event', 'audit'])(
    'rolls back CANCELLED, counters and owned row states when %s fails',
    async (stage) => {
      const f = fixture();
      f.state().products = [product('z-product'), product('a-product')];
      await f.initiate(
        request({
          items: [
            { productId: 'z-product', quantity: 2 },
            { productId: 'a-product', quantity: 1 },
          ],
        }),
      );
      const before = f.state();
      const failure = new Error(`cancel-${stage}`);
      if (stage === 'loan-CAS')
        f.tx.moneyLoan.updateMany.mockResolvedValueOnce({ count: 0 });
      if (stage === 'second-counter') {
        const update = f.tx.product.updateMany.getMockImplementation()!;
        f.tx.product.updateMany
          .mockImplementationOnce(update)
          .mockResolvedValueOnce({ count: 0 });
      }
      if (stage === 'claim')
        f.tx.posLoanSaleReservation.updateMany.mockResolvedValueOnce({
          count: 0,
        });
      if (stage === 'event')
        f.tx.moneyLoanEvent.create.mockRejectedValueOnce(failure);
      if (stage === 'audit')
        f.tx.auditLog.create.mockRejectedValueOnce(failure);
      await expect(f.cancel()).rejects.toThrow(
        ['loan-CAS', 'second-counter', 'claim'].includes(stage)
          ? ConflictException
          : failure,
      );
      expect(f.state()).toEqual(before);
      expect(f.state().loan.status).toBe('OPEN');
      expect(f.state().holds.every((row) => row.state === 'HELD')).toBe(true);
      expect(f.outsideWrite).not.toHaveBeenCalled();
    },
  );

  it('rejects paid cancellation without changing holds', async () => {
    const f = fixture();
    await f.initiate();
    const beforeHolds = f.state().holds.map((row) => ({ ...row }));
    f.tx.product.updateMany.mockClear();
    f.state().loan.events.push({
      id: 'paid',
      type: 'COLLECTED',
      amount: new Prisma.Decimal(1),
      reversesId: null,
    });
    await expect(f.cancel()).rejects.toThrow(ConflictException);
    expect(f.state().holds).toEqual(beforeHolds);
    expect(f.tx.product.updateMany).not.toHaveBeenCalled();
    expect(f.tx.posLoanSaleReservation.updateMany).not.toHaveBeenCalled();
  });
  it('keeps independent cancellation free of physical effects', async () => {
    const f = fixture();
    await expect(f.cancel()).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(f.tx.product.updateMany).not.toHaveBeenCalled();
    expect(f.tx.posLoanSaleReservation.updateMany).not.toHaveBeenCalled();
    noSaleEffects(f.tx);
  });

  it('subtracts a provided sale-wide discount from the financed total like an ordinary sale', async () => {
    const f = fixture();
    const undiscounted = await f.initiate({
      ...request({
        requestKey: 'pos-key-full',
        items: [{ productId: 'coffee', quantity: 2, unitPrice: 120 }],
      }),
    });
    expect(undiscounted).toMatchObject({ agreedCustomerTotal: '285.60' });
    const discounted = {
      ...request({
        requestKey: 'pos-key-discount',
        items: [{ productId: 'coffee', quantity: 2, unitPrice: 120 }],
      }),
      discountAmount: 10,
    };
    const result = await f.initiate(discounted);
    expect(result).toMatchObject({ agreedCustomerTotal: '275.60' });
    const loanData = f.tx.moneyLoan.create.mock.calls[1][0].data;
    expect((loanData.amount as Prisma.Decimal).toFixed(2)).toBe('275.60');
    noSaleEffects(f.tx);
  });

  it.each([178.5, 200])(
    'rejects discount %s leaving no positive principal',
    async (discountAmount) => {
      const f = fixture();
      const dto = { ...request(), discountAmount };
      await expect(f.initiate(dto)).rejects.toThrow(BadRequestException);
      noNewWrites(f.tx);
    },
  );

  it('conflicts when the same key changes only the sale-wide discount', async () => {
    const f = fixture();
    const original = { ...request(), discountAmount: 10 };
    await f.initiate(original);
    const changed = { ...request(), discountAmount: 5 };
    await expect(f.initiate(changed)).rejects.toThrow(ConflictException);
    expect(f.state().intents).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
  });

  it('replays a legacy intent when an explicit zero sale-wide discount matches the original payload', async () => {
    const f = fixture();
    const initiated = await f.initiate();
    const quoteSnapshot = {
      agreedCustomerTotal: '178.50',
      items: [
        {
          productId: 'coffee',
          quantity: 2,
          resolvedUnitPrice: '80.00',
          discountAmount: '10.00',
        },
      ],
    };
    const original = { ...initiated, quoteSnapshot };
    Object.assign(f.state().intents[0], {
      quoteSnapshot,
      initiationResult: original,
    });
    f.state().loan.status = 'CANCELLED';
    f.tx.product.findMany.mockClear();
    f.tx.customer.findFirst.mockClear();
    const zeroDiscount = { ...request(), discountAmount: 0 };
    expect(await f.initiate(zeroDiscount)).toEqual(original);
    expect(f.tx.moneyLoan.create).toHaveBeenCalledTimes(1);
    expect(f.tx.product.findMany).not.toHaveBeenCalled();
    expect(f.tx.customer.findFirst).not.toHaveBeenCalled();
  });
});

describe('CreatePosLoanDto boundary', () => {
  it('accepts the customer-only nested cart and trims the original reason', async () => {
    const dto = plainToInstance(
      CreatePosLoanDto,
      request({ reason: ' Compra financiada ' }),
    );
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    expect(dto.reason).toBe('Compra financiada');
  });
  it.each([
    'amount',
    'quoteSnapshot',
    'origin',
    'type',
    'supplierId',
    'employeeId',
  ])('rejects client-owned %s', async (field) => {
    const dto = plainToInstance(CreatePosLoanDto, {
      ...request(),
      [field]: 'forbidden',
    });
    expect(
      (
        await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
      ).some((error) => error.property === field),
    ).toBe(true);
  });
  it.each([
    { issuedAt: '2026-02-30' },
    { dueAt: '2026-11-13T12:00:00Z' },
    { reason: ' ' },
    { requestKey: ' ' },
    { items: [] },
    { items: [{ productId: 'coffee', quantity: 0 }] },
  ])('rejects malformed nested/date/reason input %j', async (changes) => {
    expect(
      await validate(
        plainToInstance(CreatePosLoanDto, { ...request(), ...changes }),
      ),
    ).not.toEqual([]);
  });
});

describe('POS initiation controller boundary', () => {
  it('forwards exact identities and the original result', async () => {
    const f = fixture();
    const dto = request();
    const user = actor();
    const result = { loanId: 'original-result' };
    const spy = jest.spyOn(f.service, 'initiateFromPos');
    spy.mockResolvedValue(result);
    const controller = new LoansController(f.service);
    expect(await controller.initiateFromPos(dto, user)).toBe(result);
    expect(spy.mock.calls[0][0]).toBe(dto);
    expect(spy.mock.calls[0][1]).toBe(user.organizationId);
    expect(spy.mock.calls[0][2]).toBe(user);
  });

  it('rejects missing organization before writes', async () => {
    const f = fixture();
    const user = actor();
    user.organizationId = undefined;
    const controller = new LoansController(f.service);
    await expect(controller.initiateFromPos(request(), user)).rejects.toThrow(
      ForbiddenException,
    );
    noNewWrites(f.tx);
  });

  it('declares the CASHIER POST pos-initiation route', () => {
    const handler = LoansController.prototype.initiateFromPos;
    expect(Reflect.getMetadata('path', handler)).toBe('pos-initiation');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([OrgRole.CASHIER]);
  });
});

describe('Explicit POS sale completion', () => {
  it.each(['tracked', 'SERVICE', 'untracked'])(
    'completes a paid OPEN %s cart from frozen money without another Payment',
    async (kind) => {
      const f = fixture();
      if (kind === 'SERVICE') f.state().products[0].type = 'SERVICE';
      if (kind === 'untracked') f.state().products[0].tracksStock = false;
      const dto = { ...request(), discountAmount: 10 };
      const initiated = await f.initiate(dto);
      await expect(f.collect()).resolves.toMatchObject({
        status: 'OPEN',
        paymentStatus: 'PAID',
        balance: '0.00',
      });
      const foreign = {
        id: 'foreign-hold',
        intentId: 'other-intent',
        organizationId: 'org',
        productId: 'other-product',
        quantity: 3,
        state: 'HELD',
      };
      f.state().holds.push(foreign);
      Object.assign(f.state().products[0], {
        salePrice: new Prisma.Decimal(999),
        taxRate: new Prisma.Decimal(99),
        costPrice: new Prisma.Decimal(900),
      });

      const result = await f.complete();
      expect(result).toMatchObject({
        loanId: 'loan',
        saleId: 'sale',
        status: 'CLOSED',
      });
      expect(f.state().loan.amount.toFixed(2)).toBe('168.50');
      expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
        organizationId: 'org',
        customerId: request().customerId,
        status: 'COMPLETED',
        saleNumber: 42,
        change: null,
        subtotal: new Prisma.Decimal(150),
        taxAmount: new Prisma.Decimal('28.50'),
        discountAmount: new Prisma.Decimal(10),
        total: new Prisma.Decimal('168.50'),
        amountPaid: new Prisma.Decimal('168.50'),
      });
      expect(f.tx.saleItem.create.mock.calls[0][0].data).toMatchObject({
        saleId: 'sale',
        productId: 'coffee',
        quantity: 2,
        taxRate: 19,
        taxCode: 'IVA',
        taxAmount: 28.5,
        unitPrice: new Prisma.Decimal(80),
        costPriceSnapshot: new Prisma.Decimal(40),
        discountAmount: new Prisma.Decimal(10),
      });
      // Spec S8: the financed sale registers its fiscal document in the same
      // transaction, from the frozen quote facts, exactly like a cash sale.
      expect(f.tx.fiscalDocument.create).toHaveBeenCalledTimes(1);
      const fiscal = f.tx.fiscalDocument.create.mock.calls[0][0].data;
      expect(fiscal).toMatchObject({
        organizationId: 'org',
        saleId: 'sale',
        status: 'PENDING',
      });
      expect(fiscal.snapshot).toMatchObject({
        version: 1,
        saleId: 'sale',
        organizationId: 'org',
        currency: 'COP',
        issuerTaxId: '900123456',
        buyerTaxId: '900.111.222-3',
        lineExtensionAmount: '150.00',
        taxAmount: '28.50',
        discountAmount: '10.00',
        payableAmount: '168.50',
        amountPaid: '168.50',
        change: null,
        lines: [
          expect.objectContaining({
            lineNumber: 1,
            productId: 'coffee',
            quantity: 2,
            unitPrice: '80.00',
            discountAmount: '10.00',
            subtotal: '150.00',
            taxRate: '19.00',
            taxCode: 'IVA',
            taxAmount: '28.50',
            total: '178.50',
          }),
        ],
      });
      expect(f.state().intents[0].finalSaleId).toBe('sale');
      expect(f.state().loan.status).toBe('CLOSED');
      expect(f.state().holds.find((hold) => hold.id === foreign.id)).toEqual(
        foreign,
      );
      if (kind === 'tracked') {
        expect(f.state().products[0]).toMatchObject({
          stock: 10,
          reservedStock: 3,
        });
        const owned = f
          .state()
          .holds.find((hold) => hold.intentId === initiated.intentId);
        expect(owned).toMatchObject({
          state: 'CONSUMED',
          finalizedById: 'actor',
          finalizedAt: expect.any(Date),
        });
        expect(f.tx.product.updateMany.mock.calls[1][0]).toEqual({
          where: {
            id: 'coffee',
            organizationId: 'org',
            version: 8,
            stock: 12,
            reservedStock: 5,
          },
          data: {
            stock: { decrement: 2 },
            reservedStock: { decrement: 2 },
            version: { increment: 1 },
          },
        });
        const movement = f.tx.inventoryMovement.create.mock.calls[0][0].data;
        expect(movement).toMatchObject({
          saleId: 'sale',
          type: 'SALE',
          quantity: -2,
        });
        expect(f.tx.sale.create.mock.invocationCallOrder[0]).toBeLessThan(
          f.tx.posLoanSaleIntent.updateMany.mock.invocationCallOrder[0],
        );
        const linkOrder =
          f.tx.posLoanSaleIntent.updateMany.mock.invocationCallOrder[0];
        const consumeOrder =
          f.tx.posLoanSaleReservation.updateMany.mock.invocationCallOrder[0];
        expect(linkOrder).toBeLessThan(consumeOrder);
      } else {
        expect(f.tx.product.updateMany).not.toHaveBeenCalled();
        expect(f.tx.posLoanSaleReservation.updateMany).not.toHaveBeenCalled();
        expect(f.tx.inventoryMovement.create).not.toHaveBeenCalled();
      }
      expect(f.tx.payment.create).not.toHaveBeenCalled();
      expect(f.outsideWrite).not.toHaveBeenCalled();
      expect(f.sequence.nextNumber).toHaveBeenCalledWith(
        f.tx,
        'org',
        'SALE',
        expect.any(Number),
      );
      expect(f.tx.moneyLoanEvent.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CLOSED',
            requestKey: 'complete-key',
            result: expect.objectContaining({ saleId: 'sale' }),
          }),
        }),
      );
      expect(f.tx.auditLog.create).toHaveBeenCalledTimes(3);
      expect(f.prisma.$transaction).toHaveBeenLastCalledWith(
        expect.any(Function),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  );

  // Spec S9 — «solo para quienes la tienen activa»: the financed sale honours
  // the same activation decision as a cash sale. No activation, no fiscal row;
  // the financed sale itself is untouched.
  it('registers no fiscal document when the organization has not activated electronic invoicing', async () => {
    const f = fixture();
    f.organization.settings = {};
    await f.initiate();
    await f.collect();

    await expect(f.complete()).resolves.toMatchObject({
      saleId: 'sale',
      status: 'CLOSED',
    });

    expect(f.tx.sale.create).toHaveBeenCalledTimes(1);
    expect(f.tx.saleItem.create).toHaveBeenCalledTimes(1);
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // A quote written before this feature carries the rate but not the tribute
  // code. Simulates a stored pre-tax-code quote by removing the code from the
  // frozen snapshot the initiation result points at.
  const stripQuoteTaxCodes = (f: ReturnType<typeof fixture>) => {
    const snapshot = f.state().intents[0].quoteSnapshot as {
      items: Row[];
    };
    const legacy = {
      ...snapshot,
      items: snapshot.items.map((item) => {
        const row = { ...item };
        delete row.taxCode;
        return row;
      }),
    };
    f.state().intents[0].quoteSnapshot = legacy;
    (f.state().intents[0].initiationResult as Row).quoteSnapshot = legacy;
  };

  // Two 0.03 lines at 19%: each line's exact tax is 0.0057 and its own rounding
  // is 0.01, while the agreed tax of the whole quote is one rounding of 0.0114,
  // i.e. 0.01. The agreed payable (0.07) is fixed, so the lines share that cent
  // instead of moving the agreement.
  const fractionalCentItems = () => [
    { productId: 'coffee', quantity: 1, unitPrice: 0.03, discountAmount: 0 },
    { productId: 'coffee', quantity: 1, unitPrice: 0.03, discountAmount: 0 },
  ];
  const saleRows = (f: ReturnType<typeof fixture>) =>
    f.tx.saleItem.create.mock.calls.map((call) => call[0].data);
  const snapshotLines = (f: ReturnType<typeof fixture>) => {
    const fiscal = f.tx.fiscalDocument.create.mock.calls[0][0].data as {
      snapshot: {
        lines: Array<{ taxCode: string | null; taxAmount: string | null }>;
      };
    };
    return fiscal.snapshot.lines;
  };

  // Spec S9: an organization without electronic invoicing keeps the exact
  // previous completion behavior, including quotes stored before tax codes.
  it('completes a pre-tax-code quote unchanged when electronic invoicing is not active', async () => {
    const f = fixture();
    f.organization.settings = {};
    await f.initiate();
    await f.collect();
    stripQuoteTaxCodes(f);

    await expect(f.complete()).resolves.toMatchObject({
      saleId: 'sale',
      status: 'CLOSED',
    });

    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal(150),
      taxAmount: new Prisma.Decimal('28.50'),
      discountAmount: new Prisma.Decimal(0),
      total: new Prisma.Decimal('178.50'),
    });
    const item = saleRows(f)[0];
    // Exact pre-feature row: no per-line fiscal facts are invented.
    expect(item).not.toHaveProperty('taxCode');
    expect(item).not.toHaveProperty('taxAmount');
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // Spec S9/S8: a sale-wide discount does not change what the disabled path
  // writes. The legacy row shape and every money value stay pre-feature.
  it('completes a discounted pre-tax-code quote unchanged when invoicing is not active', async () => {
    const f = fixture();
    f.organization.settings = {};
    await f.initiate({ ...request(), discountAmount: 10 });
    await f.collect();
    stripQuoteTaxCodes(f);

    await expect(f.complete()).resolves.toMatchObject({ status: 'CLOSED' });

    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal(150),
      taxAmount: new Prisma.Decimal('28.50'),
      discountAmount: new Prisma.Decimal(10),
      total: new Prisma.Decimal('168.50'),
    });
    expect(saleRows(f)[0]).not.toHaveProperty('taxCode');
    expect(saleRows(f)[0]).not.toHaveProperty('taxAmount');
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // The same frozen quote registers the same sale money under either activation
  // decision: only the fiscal facts (line codes/amounts and the document) differ.
  it('registers the same sale money whether or not electronic invoicing is active', async () => {
    const money = async (settings: Record<string, unknown>) => {
      const f = fixture();
      f.organization.settings = settings;
      await f.initiate();
      await f.collect();
      await f.complete();
      const data = f.tx.sale.create.mock.calls[0][0].data;
      return {
        subtotal: String(data.subtotal),
        taxAmount: String(data.taxAmount),
        discountAmount: String(data.discountAmount),
        total: String(data.total),
        amountPaid: String(data.amountPaid),
        change: data.change as string | null,
      };
    };
    expect(await money({ electronicInvoicing: { enabled: true } })).toEqual(
      await money({}),
    );
  });

  // Spec S9 again, with money that does not round per line: the sale must keep
  // the old `Sale.taxAmount` (one rounding of the unrounded total) and must not
  // persist line facts, because no document will ever describe them.
  it('keeps the previous money and no line tax facts for a fractional-cent quote when invoicing is not active', async () => {
    const f = fixture();
    f.organization.settings = {};
    await f.initiate(request({ items: fractionalCentItems() }));
    await f.collect();

    await expect(f.complete()).resolves.toMatchObject({
      saleId: 'sale',
      status: 'CLOSED',
    });

    expect(f.state().loan.amount.toFixed(2)).toBe('0.07');
    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal('0.06'),
      taxAmount: new Prisma.Decimal('0.01'),
      total: new Prisma.Decimal('0.07'),
    });
    for (const row of saleRows(f)) {
      expect(row).not.toHaveProperty('taxCode');
      expect(row).not.toHaveProperty('taxAmount');
    }
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // Enabled organizations fail closed: a quote without tax codes cannot be
  // classified without inventing a tribute, so the sale is not registered.
  it('refuses a pre-tax-code quote when electronic invoicing is active', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    await f.initiate();
    await f.collect();
    stripQuoteTaxCodes(f);

    await expect(f.complete()).rejects.toThrow(ConflictException);

    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
    expect(f.tx.posLoanSaleIntent.updateMany).not.toHaveBeenCalled();
  });

  // A legacy quote has no tax to classify when every row's rate is zero, so
  // refusing it would fail closed where nothing is missing. It completes with an
  // honest zero-tax document instead of an invented tribute.
  it('completes an activated quote whose legacy rows carry no tax to classify', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    f.state().products[0].taxable = false;
    f.state().products[0].category = {
      taxable: false,
      defaultTaxRate: new Prisma.Decimal(0),
    };
    await f.initiate(
      request({
        items: [{ productId: 'coffee', quantity: 1, discountAmount: 0 }],
      }),
    );
    await f.collect();
    stripQuoteTaxCodes(f);

    await expect(f.complete()).resolves.toMatchObject({ status: 'CLOSED' });

    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal('80.00'),
      taxAmount: new Prisma.Decimal(0),
      total: new Prisma.Decimal('80.00'),
    });
    // Activated: the row carries fiscal facts, and for a quote with no tax those
    // facts are honestly null instead of an invented tribute.
    expect(saleRows(f)[0]).toEqual(
      expect.objectContaining({ taxCode: null, taxAmount: null }),
    );
    expect(snapshotLines(f)).toEqual([
      expect.objectContaining({ taxCode: null, taxAmount: null }),
    ]);
    expect(f.tx.fiscalDocument.create.mock.calls[0][0].data).toMatchObject({
      snapshot: {
        lineExtensionAmount: '80.00',
        taxAmount: '0.00',
        payableAmount: '80.00',
      },
    });
  });

  // The regression this closes: a valid quote whose per-line roundings lose one
  // cent used to answer 409 even though its agreement reconstructed exactly.
  // The agreed tax is distributed across the lines instead of moving the total.
  // Two lines of 0.03 at 19%: each line owes tax (0.0057), the agreed tax is one
  // cent, and only one line can carry it. Relabelling the other as untaxed while
  // its rate stays 19% is a fiscal claim whose DIAN meaning is unproven (S6,
  // L72), so an activated organization fails closed instead of inventing it.
  it('fails closed instead of dropping the tax code of a taxed fractional-cent line', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    await f.initiate(request({ items: fractionalCentItems() }));
    await f.collect();
    const before = f.state();
    f.tx.moneyLoan.updateMany.mockClear();

    await expect(f.complete()).rejects.toThrow(ConflictException);

    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
    expect(f.tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(f.state()).toEqual(before);
  });

  // The same quote is still completed for an organization that does not invoice:
  // no line facts, no document, and the pre-feature money. Failing closed there
  // would change inactive behaviour for no fiscal gain.
  it('keeps completing the same taxed fractional-cent quote when invoicing is not active', async () => {
    const f = fixture();
    f.organization.settings = {};
    await f.initiate(request({ items: fractionalCentItems() }));
    await f.collect();

    await expect(f.complete()).resolves.toMatchObject({ status: 'CLOSED' });

    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal('0.06'),
      taxAmount: new Prisma.Decimal('0.01'),
      total: new Prisma.Decimal('0.07'),
    });
    for (const row of saleRows(f)) {
      expect(row).not.toHaveProperty('taxCode');
      expect(row).not.toHaveProperty('taxAmount');
    }
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // DISCLOSED LIMITATION (L75): a valid financed quote whose payable was rounded
  // once from JS floats at initiation cannot always be rebuilt from its own
  // decimals. 2826.30 of goods at 5% minus a 1569.23 discount is 1398.3849999999998
  // at the POS, i.e. 1398.38, while the same money rebuilt exactly is 1398.39.
  // The payable is never moved and no tax is derived from it, so this quote fails
  // closed until fiscal policy for such cent differences is supported.
  it('fails closed on a valid quote whose floats landed one cent below its decimals', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    f.state().products[0].salePrice = new Prisma.Decimal('284.34');
    // A zero percentage is the fixture's no-op promotion: the list price holds.
    f.state().products[0].promotionValue = new Prisma.Decimal(0);
    f.state().products[0].taxRate = new Prisma.Decimal(5);
    f.state().products[0].stock = 100;
    await f.initiate({
      ...request({
        items: [{ productId: 'coffee', quantity: 10, discountAmount: 17.1 }],
      }),
      discountAmount: 1569.23,
    });
    await f.collect();

    expect(f.state().loan.amount.toFixed(2)).toBe('1398.38');

    await expect(f.complete()).rejects.toThrow(ConflictException);

    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // The same one-cent gap is refused even when the quote is otherwise ordinary:
  // no payable movement, no derived tax, no document. This is the case the
  // invented tolerance used to absorb.
  it('fails closed on a one-cent disagreement between payable and reconstruction', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    await f.initiate();
    await f.collect();
    // The agreement keeps its own number; the lines still rebuild 178.50.
    f.state().loan.amount = new Prisma.Decimal('178.51');
    f.state().intents[0].agreedCustomerTotal = new Prisma.Decimal('178.51');

    await expect(f.complete()).rejects.toThrow(ConflictException);

    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // The same quote stays refused for an inactive organization. Rebuilding its
  // payable from the exact decimals gives 1398.39 while the POS quoted 1398.38,
  // and that is exactly what HEAD did: inactive behaviour is not part of this
  // correction (L72).
  it('keeps the pre-feature refusal of that quote when invoicing is not active', async () => {
    const f = fixture();
    f.organization.settings = {};
    f.state().products[0].salePrice = new Prisma.Decimal('284.34');
    // A zero percentage is the fixture's no-op promotion: the list price holds.
    f.state().products[0].promotionValue = new Prisma.Decimal(0);
    f.state().products[0].taxRate = new Prisma.Decimal(5);
    f.state().products[0].stock = 100;
    await f.initiate({
      ...request({
        items: [{ productId: 'coffee', quantity: 10, discountAmount: 17.1 }],
      }),
      discountAmount: 1569.23,
    });
    await f.collect();

    await expect(f.complete()).rejects.toThrow(ConflictException);
    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.tx.fiscalDocument.create).not.toHaveBeenCalled();
  });

  // A sale-wide discount of half a cent is normalized to one cent before the
  // agreed total is computed, so initiation and completion agree on it; the
  // payable the POS quoted (1.04) is what the document records.
  it('keeps a fractional-cent sale-wide discount reconciled with its agreement', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    f.state().products[0].salePrice = new Prisma.Decimal('1.00');
    // A zero percentage is the fixture's no-op promotion: the list price holds.
    f.state().products[0].promotionValue = new Prisma.Decimal(0);
    f.state().products[0].taxRate = new Prisma.Decimal(5);
    await f.initiate({
      ...request({
        items: [{ productId: 'coffee', quantity: 1, discountAmount: 0 }],
      }),
      discountAmount: 0.005,
    });
    await f.collect();

    expect(f.state().loan.amount.toFixed(2)).toBe('1.04');
    expect(f.state().intents[0].quoteSnapshot).toMatchObject({
      discountAmount: '0.01',
    });

    await expect(f.complete()).resolves.toMatchObject({ status: 'CLOSED' });

    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal('1.00'),
      taxAmount: new Prisma.Decimal('0.05'),
      discountAmount: new Prisma.Decimal('0.01'),
      total: new Prisma.Decimal('1.04'),
    });
    expect(f.tx.fiscalDocument.create.mock.calls[0][0].data).toMatchObject({
      snapshot: {
        lineExtensionAmount: '1.00',
        taxAmount: '0.05',
        discountAmount: '0.01',
        payableAmount: '1.04',
      },
    });
  });

  // The payable is never absorbed into the tax: a quote whose stored agreement
  // its own lines do not reconstruct is refused, whatever the size of the gap.
  it('refuses an agreement that its own lines do not reconstruct', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    await f.initiate();
    await f.collect();
    f.state().loan.amount = new Prisma.Decimal('178.45');
    f.state().intents[0].agreedCustomerTotal = new Prisma.Decimal('178.45');

    await expect(f.complete()).rejects.toThrow(ConflictException);

    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
  });

  // Three lines of 33.33 at 19%: exact tax 18.9981, agreed tax 19.00, per-line
  // rounding 6.33 each. The payable stays 118.99 and the lines share 19.00.
  it('preserves the agreed payable when per-line tax rounding loses a cent', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    await f.initiate(
      request({
        items: [0, 1, 2].map(() => ({
          productId: 'coffee',
          quantity: 1,
          unitPrice: 33.33,
          discountAmount: 0,
        })),
      }),
    );
    await f.collect();

    await expect(f.complete()).resolves.toMatchObject({ status: 'CLOSED' });

    expect(f.state().loan.amount.toFixed(2)).toBe('118.99');
    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal('99.99'),
      taxAmount: new Prisma.Decimal('19.00'),
      total: new Prisma.Decimal('118.99'),
    });
    const rows = saleRows(f);
    expect(rows.map((row) => row.taxCode)).toEqual(['IVA', 'IVA', 'IVA']);
    expect(rows.map((row) => row.taxAmount)).toEqual([6.34, 6.33, 6.33]);
    expect(rows.reduce((total, row) => total + Number(row.taxAmount), 0)).toBe(
      19,
    );
    const lines = snapshotLines(f);
    expect(lines.map((line) => line.taxAmount)).toEqual([
      '6.34',
      '6.33',
      '6.33',
    ]);
    expect(
      lines
        .reduce((total, line) => total + Number(line.taxAmount), 0)
        .toFixed(2),
    ).toBe('19.00');
  });

  // Positive control: a fractional-cent line that still reconciles completes,
  // and the snapshot's own money identity holds to the cent.
  it('issues a consistent snapshot for an activated fractional-cent quote that reconciles', async () => {
    const f = fixture();
    f.organization.settings = { electronicInvoicing: { enabled: true } };
    await f.initiate(
      request({
        items: [
          {
            productId: 'coffee',
            quantity: 1,
            unitPrice: 33.34,
            discountAmount: 0,
          },
        ],
      }),
    );
    await f.collect();

    await expect(f.complete()).resolves.toMatchObject({ status: 'CLOSED' });

    expect(f.tx.sale.create.mock.calls[0][0].data).toMatchObject({
      subtotal: new Prisma.Decimal('33.34'),
      taxAmount: new Prisma.Decimal('6.33'),
      total: new Prisma.Decimal('39.67'),
    });
    const fiscal = f.tx.fiscalDocument.create.mock.calls[0][0].data;
    expect(fiscal.snapshot).toMatchObject({
      lineExtensionAmount: '33.34',
      taxAmount: '6.33',
      discountAmount: '0.00',
      payableAmount: '39.67',
      lines: [
        expect.objectContaining({
          taxCode: 'IVA',
          taxAmount: '6.33',
          total: '39.67',
        }),
      ],
    });
    const cents = (value: string) => Math.round(Number(value) * 100);
    const snapshot = fiscal.snapshot as {
      lineExtensionAmount: string;
      taxAmount: string;
      discountAmount: string;
      payableAmount: string;
    };
    expect(
      cents(snapshot.lineExtensionAmount) +
        cents(snapshot.taxAmount) -
        cents(snapshot.discountAmount),
    ).toBe(cents(snapshot.payableAmount));
  });

  // The document describes the quote that was agreed, not the catalog as it
  // looks at completion time.
  it('snapshots the frozen quote facts after the catalog changed', async () => {
    const f = fixture();
    await f.initiate();
    await f.collect();
    Object.assign(f.state().products[0], {
      salePrice: new Prisma.Decimal(999),
      taxRate: new Prisma.Decimal(99),
      taxCode: 'INC',
    });

    await f.complete();

    const fiscal = f.tx.fiscalDocument.create.mock.calls[0][0].data;
    expect(fiscal.snapshot).toMatchObject({
      taxAmount: '28.50',
      payableAmount: '178.50',
      lines: [
        expect.objectContaining({
          unitPrice: '80.00',
          taxRate: '19.00',
          taxCode: 'IVA',
          taxAmount: '28.50',
        }),
      ],
    });
  });

  it.each([
    'unpaid',
    'partial',
    'standalone',
    'cancelled',
    'closed',
    'legacy',
    'wrong-type',
    'used-key',
  ])('rejects %s completion before writes', async (kind) => {
    const f = fixture();
    if (kind !== 'standalone') await f.initiate();
    if (kind === 'cancelled') await f.cancel();
    else if (kind !== 'unpaid')
      await f.collect(kind === 'partial' ? 10 : undefined);
    if (kind === 'closed') f.state().loan.status = 'CLOSED';
    if (kind === 'wrong-type') f.state().loan.type = 'SERVICE';
    if (kind === 'legacy') {
      f.state().intents[0].quoteSnapshot = {
        agreedCustomerTotal: '178.50',
        items: [
          {
            productId: 'coffee',
            quantity: 2,
            resolvedUnitPrice: '80.00',
            discountAmount: '10.00',
          },
        ],
      };
    }
    const writes = [
      f.tx.moneyLoan.updateMany,
      f.tx.moneyLoanEvent.create,
      f.tx.auditLog.create,
      f.tx.product.updateMany,
      f.tx.posLoanSaleIntent.updateMany,
      f.tx.posLoanSaleReservation.updateMany,
    ];
    const counts = writes.map((write) => write.mock.calls.length);
    const key = kind === 'used-key' ? 'collection-key' : 'complete-key';
    await expect(f.complete(key)).rejects.toThrow(ConflictException);
    writes.forEach((write, index) =>
      expect(write).toHaveBeenCalledTimes(counts[index]),
    );
    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.sequence.nextNumber).not.toHaveBeenCalled();
  });

  it('rejects a valid Q1 quote whose rounded line discounts cannot reconstruct its fixed principal', async () => {
    const f = fixture();
    await f.initiate(
      request({
        items: [
          { productId: 'coffee', quantity: 1, discountAmount: 0.005 },
          { productId: 'coffee', quantity: 1, discountAmount: 0.005 },
        ],
      }),
    );
    await f.collect();
    expect(f.state().loan.amount.toFixed(2)).toBe('190.39');
    expect(f.state().intents[0].quoteSnapshot).toMatchObject({
      items: [
        { resolvedUnitPrice: '80.00', discountAmount: '0.01', taxRate: 19 },
        { resolvedUnitPrice: '80.00', discountAmount: '0.01', taxRate: 19 },
      ],
    });
    const reconstructed = new Prisma.Decimal(80)
      .minus('0.01')
      .times(2)
      .times('1.19');
    expect(reconstructed.toFixed(2, Prisma.Decimal.ROUND_HALF_UP)).toBe(
      '190.38',
    );
    const before = f.state();
    f.tx.moneyLoan.updateMany.mockClear();
    f.tx.moneyLoanEvent.create.mockClear();
    f.tx.auditLog.create.mockClear();
    f.tx.product.updateMany.mockClear();
    await expect(f.complete()).rejects.toThrow(ConflictException);
    noSaleEffects(f.tx);
    expect(f.tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(f.tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.tx.product.updateMany).not.toHaveBeenCalled();
    expect(f.tx.posLoanSaleIntent.updateMany).not.toHaveBeenCalled();
    expect(f.sequence.nextNumber).not.toHaveBeenCalled();
    expect(f.state()).toEqual(before);
  });

  it('replays the stored completion before live reads and conflicts on another actor or key', async () => {
    const f = fixture();
    await f.initiate();
    await f.collect();
    const original = await f.complete();
    for (const mock of [
      f.tx.product.findFirst,
      f.tx.product.findMany,
      f.tx.customer.findFirst,
      f.sequence.nextNumber,
      f.tx.sale.create,
      f.tx.saleItem.create,
      f.tx.moneyLoan.updateMany,
      f.tx.moneyLoanEvent.create,
      f.tx.auditLog.create,
      f.tx.product.updateMany,
      f.tx.posLoanSaleIntent.updateMany,
      f.tx.posLoanSaleReservation.updateMany,
      f.tx.inventoryMovement.create,
    ])
      mock.mockClear();
    expect(await f.complete()).toEqual(original);
    const changedActor = { ...actor(), userId: 'other-actor' };
    await expect(f.complete('complete-key', changedActor)).rejects.toThrow(
      ConflictException,
    );
    const duplicate = f.complete('second-key');
    await expect(duplicate).rejects.toThrow(ConflictException);
    expect(f.tx.product.findFirst).not.toHaveBeenCalled();
    expect(f.tx.product.findMany).not.toHaveBeenCalled();
    expect(f.tx.customer.findFirst).not.toHaveBeenCalled();
    expect(f.sequence.nextNumber).not.toHaveBeenCalled();
    noSaleEffects(f.tx);
    expect(f.tx.saleItem.create).not.toHaveBeenCalled();
    expect(f.tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(f.tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.tx.posLoanSaleIntent.updateMany).not.toHaveBeenCalled();
    expect(f.tx.posLoanSaleReservation.updateMany).not.toHaveBeenCalled();
  });

  it.each(['loan-CAS', 'link-claim', 'stock-CAS'])(
    'propagates %s failure and discards local staged loan/intent/hold/counter changes',
    async (stage) => {
      const f = fixture();
      await f.initiate();
      await f.collect();
      const before = f.state();
      if (stage === 'loan-CAS')
        f.tx.moneyLoan.updateMany.mockResolvedValue({ count: 0 });
      if (stage === 'link-claim')
        f.tx.posLoanSaleIntent.updateMany.mockResolvedValue({ count: 0 });
      if (stage === 'stock-CAS')
        f.tx.product.updateMany.mockResolvedValue({ count: 0 });
      await expect(f.complete()).rejects.toThrow(ConflictException);
      expect(f.state()).toEqual(before);
      expect(f.tx.payment.create).not.toHaveBeenCalled();
      expect(f.outsideWrite).not.toHaveBeenCalled();
    },
  );
});
