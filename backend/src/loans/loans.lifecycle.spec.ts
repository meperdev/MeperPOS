import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoansService } from './loans.service';

type Event = {
  id: string;
  type: string;
  amount: Prisma.Decimal | null;
  reversesId: string | null;
  requestKey: string;
  requestPayload: unknown;
  result: unknown;
};
const collection = { requestKey: 'key-1', amount: 40.25, method: 'CASH' };
function lifecycleFixture(type: string) {
  const loan = {
    type,
    id: 'loan',
    organizationId: 'org',
    amount: new Prisma.Decimal('100.25'),
    status: 'OPEN',
    version: 0,
    events: [] as Event[],
  };
  const tx = {
    sale: { create: jest.fn() },
    payment: { create: jest.fn() },
    product: { updateMany: jest.fn(), update: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    moneyLoan: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; organizationId: string } }) =>
          Promise.resolve(
            where.id === loan.id && where.organizationId === loan.organizationId
              ? loan
              : null,
          ),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([loan]),
      count: jest.fn().mockResolvedValue(1),
    },
    moneyLoanEvent: {
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(loan.events)),
      count: jest
        .fn()
        .mockImplementation(() => Promise.resolve(loan.events.length)),
      findFirst: jest.fn(({ where }: { where: { requestKey: string } }) =>
        Promise.resolve(
          loan.events.find((e) => e.requestKey === where.requestKey) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: Omit<Event, 'id'> }) => {
        const event = { ...data, id: `event-${loan.events.length + 1}` };
        loan.events.push(event);
        return Promise.resolve(event);
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    posLoanSaleIntent: { findFirst: jest.fn().mockResolvedValue(null) },
    posLoanSaleReservation: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    ...tx,
    moneyLoan: { ...tx.moneyLoan, updateMany: jest.fn() },
    moneyLoanEvent: { ...tx.moneyLoanEvent, create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const sequence = { nextNumber: jest.fn() } as never;
  const service = new LoansService(
    prisma as unknown as PrismaService,
    sequence,
  );
  const run = (
    kind: string,
    body: Record<string, unknown>,
    org: string | undefined = 'org',
    id = 'loan',
  ) => service.mutate(id, kind, body, 'actor', org);
  return { loan, tx, prisma, service, run };
}

describe.each(['MONEY', 'SERVICE'])('Standalone %s lifecycle', (type) => {
  const fixture = () => lifecycleFixture(type);
  it('collects partially then fully without closing, and closes explicitly', async () => {
    const { run, tx, prisma } = fixture();
    await expect(run('COLLECTED', collection)).resolves.toMatchObject({
      type,
      balance: '60.00',
      collected: '40.25',
      status: 'OPEN',
      paymentStatus: 'PARTIAL',
    });
    await expect(
      run('COLLECTED', { ...collection, requestKey: 'key-2', amount: 60 }),
    ).resolves.toMatchObject({
      balance: '0.00',
      collected: '100.25',
      status: 'OPEN',
      paymentStatus: 'PAID',
    });
    await expect(run('CLOSED', { requestKey: 'key-3' })).resolves.toMatchObject(
      {
        balance: '0.00',
        status: 'CLOSED',
      },
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.moneyLoan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'loan',
          organizationId: 'org',
          version: 0,
          status: 'OPEN',
        },
        data: expect.objectContaining({ version: { increment: 1 } }) as unknown,
      }),
    );
    expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(3);
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.moneyLoanEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({ type }) as unknown,
        }) as unknown,
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
    expect(prisma.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(prisma.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'actor',
          organizationId: 'org',
          action: 'LOAN_CLOSED',
        }) as unknown,
      }),
    );
  });

  it('reads backend-owned balance and status on detail and list', async () => {
    const { service, run } = fixture();
    await run('COLLECTED', collection);
    await expect(service.findOne('loan', 'org')).resolves.toMatchObject({
      balance: '60.00',
      paymentStatus: 'PARTIAL',
    });
    const result = await service.findAll({}, 'org');
    expect(result.data[0]).toMatchObject({
      balance: '60.00',
      collected: '40.25',
      status: 'OPEN',
    });
    expect(result.data[0]).not.toHaveProperty('events');
  });

  it.each([100.26, 120])(
    'rejects overpayment %s without writes',
    async (amount) => {
      const { run, tx } = fixture();
      await expect(run('COLLECTED', { ...collection, amount })).rejects.toThrow(
        ConflictException,
      );
      expect(tx.moneyLoan.updateMany).not.toHaveBeenCalled();
      expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    0,
    -1,
    0.001,
    12.345,
    100000000,
    NaN,
    Infinity,
    '10.00',
    null,
    {},
    true,
  ])('rejects malformed money %s for internal callers', async (amount) => {
    const { run, tx } = fixture();
    await expect(run('COLLECTED', { ...collection, amount })).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
  });

  it('replays the exact original response without duplicate events or audit', async () => {
    const { run, tx, loan } = fixture();
    const first = await run('COLLECTED', collection);
    expect(first).toMatchObject({ type });
    loan.status = 'CLOSED';
    expect(await run('COLLECTED', collection)).toEqual(first);
    expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.moneyLoanEvent.findFirst).toHaveBeenCalledWith({
      where: {
        loanId: 'loan',
        organizationId: 'org',
        requestKey: 'key-1',
      },
    });
  });

  it('replays stored snapshots without retroactively adding fields', async () => {
    const { run, loan } = fixture();
    await run('COLLECTED', collection);
    const stored = loan.events[0].result as Record<string, unknown>;
    delete stored.type;
    const replay = await run('COLLECTED', collection);
    expect(replay).toEqual({ ...stored, eventId: 'event-1' });
    expect(replay).not.toHaveProperty('type');
  });

  it.each([{ amount: 41 }, { method: 'CARD' }, { kind: 'CLOSED' }])(
    'rejects same-key different payload %j',
    async (change) => {
      const { run, tx } = fixture();
      await run('COLLECTED', collection);
      await expect(
        run(change.kind ?? 'COLLECTED', { ...collection, ...change }),
      ).rejects.toThrow(ConflictException);
      expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves a collection and records a separate reversal exactly once', async () => {
    const { run, loan, tx } = fixture();
    await run('COLLECTED', collection);
    const original = { ...loan.events[0] };
    const body = {
      requestKey: 'reverse-1',
      paymentId: original.id,
      reason: '  Corrección  ',
    };
    const reversed = await run('REVERSED', body);
    expect(reversed).toMatchObject({
      balance: '100.25',
      collected: '0.00',
      paymentStatus: 'UNPAID',
    });
    expect(loan.events[0]).toEqual(original);
    expect(loan.events[1]).toMatchObject({
      type: 'REVERSED',
      reversesId: original.id,
      amount: new Prisma.Decimal('40.25'),
      reason: 'Corrección',
    });
    expect(await run('REVERSED', body)).toEqual(reversed);
    await expect(
      run('REVERSED', { ...body, requestKey: 'reverse-2' }),
    ).rejects.toThrow(ConflictException);
    expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(2);
  });

  it.each(['foreign-payment', 'missing-payment'])(
    'rejects reversal target %s',
    async (paymentId) => {
      const { run, tx } = fixture();
      await expect(
        run('REVERSED', { requestKey: 'r', paymentId, reason: 'Corrección' }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    },
  );

  it.each(['', '  ', null, 12, 'x'.repeat(501)])(
    'requires a meaningful reversal/cancellation reason %s',
    async (reason) => {
      const { run } = fixture();
      for (const kind of ['REVERSED', 'CANCELLED']) {
        await expect(
          run(kind, { requestKey: 'r', paymentId: 'event-1', reason }),
        ).rejects.toThrow(BadRequestException);
      }
    },
  );

  it('rejects closure before full settlement and cancellation with net collections', async () => {
    const { run } = fixture();
    await expect(run('CLOSED', { requestKey: 'close' })).rejects.toThrow(
      ConflictException,
    );
    await run('COLLECTED', collection);
    await expect(
      run('CANCELLED', { requestKey: 'cancel', reason: 'Cancelación' }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows cancellation after all collections are reversed and replays cancellation', async () => {
    const { run } = fixture();
    await run('COLLECTED', collection);
    await run('REVERSED', {
      requestKey: 'r',
      paymentId: 'event-1',
      reason: 'Corrección',
    });
    const body = { requestKey: 'c', reason: 'Cancelación' };
    const result = await run('CANCELLED', body);
    expect(result).toMatchObject({ status: 'CANCELLED', balance: '100.25' });
    expect(await run('CANCELLED', body)).toEqual(result);
  });

  it.each(['CLOSED', 'CANCELLED'])(
    'rejects new money operations on %s, without reopening',
    async (status) => {
      const { run, loan, tx } = fixture();
      loan.status = status;
      for (const kind of ['COLLECTED', 'REVERSED', 'CLOSED', 'CANCELLED']) {
        await expect(
          run(kind, { ...collection, paymentId: 'p', reason: 'Corrección' }),
        ).rejects.toThrow(ConflictException);
      }
      expect(tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    },
  );

  it('permits only one simulated concurrent full collection through version CAS', async () => {
    const { run, tx, loan } = fixture();
    tx.moneyLoan.findFirst.mockImplementation(() =>
      Promise.resolve({ ...loan, events: [...loan.events] }),
    );
    let version = 0;
    tx.moneyLoan.updateMany.mockImplementation(
      ({ where }: { where: { version: number } }) => {
        const count = where.version === version ? 1 : 0;
        if (count) version++;
        return Promise.resolve({ count });
      },
    );
    const results = await Promise.allSettled([
      run('COLLECTED', { ...collection, amount: 100.25 }),
      run('COLLECTED', { ...collection, amount: 100.25, requestKey: 'second' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('preserves exact fractional Decimal totals and the full transition history', async () => {
    const { run, tx, service } = fixture();
    await run('COLLECTED', { ...collection, amount: 0.1 });
    await expect(
      run('COLLECTED', {
        ...collection,
        amount: 0.2,
        requestKey: 'fraction-2',
      }),
    ).resolves.toMatchObject({ collected: '0.30', balance: '99.95' });
    await run('REVERSED', {
      requestKey: 'r1',
      paymentId: 'event-1',
      reason: 'Corrección',
    });
    await run('REVERSED', {
      requestKey: 'r2',
      paymentId: 'event-2',
      reason: 'Corrección',
    });
    await run('CANCELLED', { requestKey: 'c', reason: 'Cancelación' });
    const history = await service.getHistory('loan', {}, 'org');
    expect(history.data.map((event) => event.type)).toEqual([
      'COLLECTED',
      'COLLECTED',
      'REVERSED',
      'REVERSED',
      'CANCELLED',
    ]);
    expect(tx.moneyLoanEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { loanId: 'loan', organizationId: 'org' },
        select: expect.objectContaining({
          amount: true,
          method: true,
          reversesId: true,
        }) as unknown,
      }),
    );
  });

  it('binds retries to the original actor and rejects reversal of a non-payment event', async () => {
    const { run, service } = fixture();
    await run('COLLECTED', collection);
    await expect(
      service.mutate('loan', 'COLLECTED', collection, 'other-actor', 'org'),
    ).rejects.toThrow(ConflictException);
    await run('REVERSED', {
      requestKey: 'r',
      paymentId: 'event-1',
      reason: 'Corrección',
    });
    await expect(
      run('REVERSED', {
        requestKey: 'r2',
        paymentId: 'event-2',
        reason: 'Corrección',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('replays closure without another transition even when the mock retains OPEN', async () => {
    const { run, tx } = fixture();
    await run('COLLECTED', { ...collection, amount: 100.25 });
    const result = await run('CLOSED', { requestKey: 'close' });
    expect(await run('CLOSED', { requestKey: 'close' })).toEqual(result);
    expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale concurrent writer through version CAS before event/audit', async () => {
    const { run, tx } = fixture();
    tx.moneyLoan.updateMany.mockResolvedValue({ count: 0 });
    await expect(run('COLLECTED', collection)).rejects.toThrow(
      ConflictException,
    );
    expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['P2034', 'P2002'])(
    'surfaces concurrent %s as an actionable retry conflict',
    async (code) => {
      const { run, prisma } = fixture();
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code,
          clientVersion: '6',
        }),
      );
      await expect(run('COLLECTED', collection)).rejects.toThrow(
        ConflictException,
      );
    },
  );

  it.each(['moneyLoanEvent', 'auditLog'] as const)(
    'propagates %s failure within the transaction, not success',
    async (delegate) => {
      const { run, tx, prisma } = fixture();
      tx[delegate].create.mockRejectedValue(new Error('write failed'));
      await expect(run('COLLECTED', collection)).rejects.toThrow(
        'write failed',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['REVERSED', 'CLOSED', 'CANCELLED'])(
    'propagates audit failure for %s instead of returning a transition',
    async (kind) => {
      const { run, tx, prisma } = fixture();
      if (kind !== 'CANCELLED') {
        await run('COLLECTED', { ...collection, amount: 100.25 });
      }
      tx.auditLog.create.mockRejectedValue(new Error('audit failed'));
      await expect(
        run(kind, {
          requestKey: 'transition',
          paymentId: 'event-1',
          reason: 'Corrección',
        }),
      ).rejects.toThrow('audit failed');
      expect(prisma.moneyLoan.updateMany).not.toHaveBeenCalled();
      expect(prisma.moneyLoanEvent.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('rejects cross-tenant/missing loans and missing organization without writes', async () => {
    const { run, tx, service } = fixture();
    await expect(run('COLLECTED', collection, 'foreign')).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      run('COLLECTED', collection, 'org', 'missing'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.mutate('loan', 'COLLECTED', collection, 'actor', undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
  });
});

describe('POS financing lifecycle bypass protection', () => {
  it('requires explicit completion instead of generic closure of a fully paid OPEN POS loan', async () => {
    const { run, tx } = lifecycleFixture('MONEY');
    tx.posLoanSaleIntent.findFirst.mockResolvedValue({
      id: 'intent',
      loanId: 'loan',
      organizationId: 'org',
      finalSaleId: null,
    });
    await expect(
      run('COLLECTED', { ...collection, amount: 100.25 }),
    ).resolves.toMatchObject({
      status: 'OPEN',
      paymentStatus: 'PAID',
      balance: '0.00',
    });
    tx.moneyLoan.updateMany.mockClear();
    tx.moneyLoanEvent.create.mockClear();
    tx.auditLog.create.mockClear();

    await expect(run('CLOSED', { requestKey: 'pos-close' })).rejects.toThrow(
      ConflictException,
    );
    expect(tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.posLoanSaleReservation.findMany).not.toHaveBeenCalled();
    expect(tx.posLoanSaleReservation.updateMany).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects a valid collection reversal after the POS intent has a final sale, before writes', async () => {
    const { run, tx, loan } = lifecycleFixture('MONEY');
    await run('COLLECTED', { ...collection, amount: 100.25 });
    // OPEN isolates the final-sale guard from the already-existing closed-status guard.
    expect(loan.status).toBe('OPEN');
    tx.posLoanSaleIntent.findFirst.mockResolvedValue({
      id: 'intent',
      loanId: 'loan',
      organizationId: 'org',
      finalSaleId: 'sale',
    });
    tx.moneyLoan.updateMany.mockClear();
    tx.moneyLoanEvent.create.mockClear();
    tx.auditLog.create.mockClear();

    await expect(
      run('REVERSED', {
        requestKey: 'linked-reversal',
        paymentId: 'event-1',
        reason: 'Corrección',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.posLoanSaleReservation.updateMany).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('preserves valid POS collection corrections before the final-sale link', async () => {
    const { run, tx, loan } = lifecycleFixture('MONEY');
    tx.posLoanSaleIntent.findFirst.mockResolvedValue({
      id: 'intent',
      loanId: 'loan',
      organizationId: 'org',
      finalSaleId: null,
    });
    await run('COLLECTED', collection);
    const collected = { ...loan.events[0] };
    await expect(
      run('REVERSED', {
        requestKey: 'pre-link-reversal',
        paymentId: collected.id,
        reason: 'Corrección',
      }),
    ).resolves.toMatchObject({
      status: 'OPEN',
      collected: '0.00',
      balance: '100.25',
      paymentStatus: 'UNPAID',
    });
    expect(loan.events[0]).toEqual(collected);
    expect(loan.events[1]).toMatchObject({
      type: 'REVERSED',
      reversesId: collected.id,
      amount: new Prisma.Decimal('40.25'),
    });
    expect(tx.moneyLoanEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('replays a stored pre-link correction before final-sale mutation guards', async () => {
    const { run, tx, loan } = lifecycleFixture('MONEY');
    tx.posLoanSaleIntent.findFirst.mockResolvedValue({
      id: 'intent',
      loanId: 'loan',
      organizationId: 'org',
      finalSaleId: null,
    });
    await run('COLLECTED', collection);
    const body = {
      requestKey: 'pre-link-reversal',
      paymentId: 'event-1',
      reason: 'Corrección',
    };
    const original = await run('REVERSED', body);
    await expect(
      run('COLLECTED', {
        ...collection,
        requestKey: 'replacement-collection',
        amount: 100.25,
      }),
    ).resolves.toMatchObject({ paymentStatus: 'PAID', balance: '0.00' });
    loan.status = 'CLOSED';
    tx.posLoanSaleIntent.findFirst.mockResolvedValue({
      id: 'intent',
      loanId: 'loan',
      organizationId: 'org',
      finalSaleId: 'sale',
    });
    tx.posLoanSaleIntent.findFirst.mockClear();
    tx.moneyLoan.updateMany.mockClear();
    tx.moneyLoanEvent.create.mockClear();
    tx.auditLog.create.mockClear();

    expect(await run('REVERSED', body)).toEqual(original);
    expect(tx.posLoanSaleIntent.findFirst).not.toHaveBeenCalled();
    expect(tx.moneyLoan.updateMany).not.toHaveBeenCalled();
    expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
