import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MonetaryLoanType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoansService } from './loans.service';
import { CounterpartyType, CreateLoanDto } from './dto/create-loan.dto';
import { QueryLoansDto } from './dto/query-loans.dto';

const dto: CreateLoanDto = {
  amount: 120.25,
  issuedAt: '2026-10-09',
  dueAt: '2026-11-09',
  reason: '  Anticipo  ',
  counterpartyType: CounterpartyType.CUSTOMER,
  counterpartyId: '00000000-0000-4000-8000-000000000001',
};

const objectContaining = (sample: Record<string, unknown>): unknown =>
  expect.objectContaining(sample) as unknown;

function fixture() {
  const tx = {
    sale: { create: jest.fn() },
    payment: { create: jest.fn() },
    product: { updateMany: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: dto.counterpartyId }),
    },
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ id: dto.counterpartyId }),
    },
    organizationUser: {
      findFirst: jest.fn().mockResolvedValue({ userId: dto.counterpartyId }),
    },
    moneyLoan: {
      create: jest
        .fn<
          Promise<{
            id: string;
            amount: Prisma.Decimal;
            status: string;
            version: number;
            events: never[];
          }>,
          [Prisma.MoneyLoanCreateArgs]
        >()
        .mockResolvedValue({
          id: 'loan',
          amount: new Prisma.Decimal(120.25),
          status: 'OPEN',
          version: 0,
          events: [],
        }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    moneyLoanEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    customer: { findFirst: jest.fn() },
    supplier: { findFirst: jest.fn() },
    organizationUser: { findFirst: jest.fn() },
    moneyLoan: { ...tx.moneyLoan, create: jest.fn() },
    moneyLoanEvent: { ...tx.moneyLoanEvent, create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return {
    tx,
    prisma,
    service: new LoansService(
      prisma as unknown as PrismaService,
      { nextNumber: jest.fn() } as never,
    ),
  };
}

describe('LoansService creation', () => {
  it.each([undefined, 'MONEY', 'SERVICE'])(
    'persists and presents type %s with an audited creation',
    async (type) => {
      const { service, tx } = fixture();
      tx.moneyLoan.create.mockImplementation(({ data, select }) =>
        Promise.resolve({
          id: 'loan',
          amount: new Prisma.Decimal(data.amount as Prisma.Decimal),
          status: 'OPEN',
          version: 0,
          events: [],
          ...(select?.type ? { type: data.type } : {}),
        }),
      );
      const reason = type === 'SERVICE' ? 'Reparación realizada' : 'Anticipo';
      const result = await service.create(
        { ...dto, reason: `  ${reason}  `, type } as CreateLoanDto,
        'actor',
        'org-a',
      );
      expect(tx.sale.create).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        type: type ?? 'MONEY',
        balance: '120.25',
      });
      expect(tx.moneyLoan.create).toHaveBeenCalledWith(
        objectContaining({
          data: objectContaining({
            type: type ?? 'MONEY',
            reason,
            issuedAt: new Date(dto.issuedAt),
            dueAt: new Date(dto.dueAt!),
            customerId: dto.counterpartyId,
          }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        objectContaining({
          data: objectContaining({
            metadata: objectContaining({ type: type ?? 'MONEY', reason }),
          }),
        }),
      );
    },
  );

  it.each(Object.values(CounterpartyType))(
    'validates %s inside the creation transaction',
    async (type) => {
      const { service, tx, prisma } = fixture();
      await service.create(
        { ...dto, counterpartyType: type },
        'actor',
        'org-a',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
      expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(prisma.moneyLoan.create).not.toHaveBeenCalled();
      expect(prisma.moneyLoanEvent.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      if (type === CounterpartyType.EMPLOYEE) {
        expect(tx.organizationUser.findFirst).toHaveBeenCalledWith({
          where: {
            userId: dto.counterpartyId,
            organizationId: 'org-a',
            user: { active: true },
          },
          select: { userId: true },
        });
      } else {
        const delegate =
          type === CounterpartyType.CUSTOMER ? tx.customer : tx.supplier;
        expect(delegate.findFirst).toHaveBeenCalledWith({
          where: {
            id: dto.counterpartyId,
            organizationId: 'org-a',
            active: true,
          },
          select: { id: true },
        });
      }
      expect(tx.moneyLoan.create).toHaveBeenCalledWith(
        objectContaining({
          data: objectContaining({
            organizationId: 'org-a',
            createdById: 'actor',
            reason: 'Anticipo',
            amount: new Prisma.Decimal(120.25),
          }),
          select: objectContaining({
            employee: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
          }),
        }),
      );
      const data = tx.moneyLoan.create.mock.calls[0][0].data;
      expect(
        [data.customerId, data.supplierId, data.employeeId].filter(Boolean),
      ).toEqual([dto.counterpartyId]);
      expect(tx.moneyLoanEvent.create).toHaveBeenCalledWith({
        data: {
          loanId: 'loan',
          organizationId: 'org-a',
          createdById: 'actor',
          type: 'CREATED',
          reason: 'Anticipo',
        },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: objectContaining({
          organizationId: 'org-a',
          userId: 'actor',
          action: 'LOAN_CREATED',
          resource: 'MoneyLoan',
          resourceId: 'loan',
          metadata: objectContaining({
            amount: '120.25',
            reason: 'Anticipo',
          }),
        }),
      });
    },
  );

  it.each([null, true, 'PRODUCTS', 'EQUIPMENT'])(
    'rejects unsupported type %j for internal callers without queries',
    async (type) => {
      const { service, prisma, tx } = fixture();
      await expect(
        service.create(
          { ...dto, type } as unknown as CreateLoanDto,
          'actor',
          'org-a',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.findAll({ type } as unknown as QueryLoansDto, 'org-a'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.moneyLoan.findMany).not.toHaveBeenCalled();
    },
  );

  const invalidParties = Object.values(CounterpartyType).flatMap((type) =>
    ['missing', 'foreign', 'inactive'].flatMap((state) =>
      Object.values(MonetaryLoanType).map((loanType) => ({
        type,
        state,
        loanType,
      })),
    ),
  );
  it.each(invalidParties)(
    'rejects $type counterparties that are $state on $loanType',
    async ({ type, state, loanType }) => {
      const { service, tx } = fixture();
      const party = {
        id: dto.counterpartyId,
        organizationId: state === 'foreign' ? 'org-b' : 'org-a',
        active: state !== 'inactive',
      };
      // These doubles apply the requested filter instead of always returning null.
      const findParty = ({
        where,
      }: {
        where: { id: string; organizationId: string; active: boolean };
      }) =>
        state !== 'missing' &&
        where.id === party.id &&
        where.organizationId === party.organizationId &&
        where.active === party.active
          ? { id: party.id }
          : null;
      tx.customer.findFirst.mockImplementation(findParty);
      tx.supplier.findFirst.mockImplementation(findParty);
      tx.organizationUser.findFirst.mockImplementation(
        ({
          where,
        }: {
          where: {
            userId: string;
            organizationId: string;
            user: { active: boolean };
          };
        }) =>
          findParty({
            where: {
              id: where.userId,
              organizationId: where.organizationId,
              active: where.user.active,
            },
          }),
      );
      await expect(
        service.create(
          { ...dto, counterpartyType: type, type: loanType },
          'actor',
          'org-a',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.moneyLoan.create).not.toHaveBeenCalled();
      expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it.each(['moneyLoan', 'moneyLoanEvent', 'auditLog'] as const)(
    'propagates %s persistence failure instead of returning success',
    async (delegate) => {
      const { service, tx } = fixture();
      tx[delegate].create.mockRejectedValue(new Error('write failed'));
      await expect(service.create(dto, 'actor', 'org-a')).rejects.toThrow(
        'write failed',
      );
      if (delegate === 'moneyLoan') {
        expect(tx.moneyLoanEvent.create).not.toHaveBeenCalled();
      }
      if (delegate !== 'auditLog') {
        expect(tx.auditLog.create).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects reversed dates before writing', async () => {
    const { service, tx } = fixture();
    await expect(
      service.create({ ...dto, dueAt: '2026-10-08' }, 'actor', 'org-a'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.moneyLoan.create).not.toHaveBeenCalled();
  });

  it('allows same-day maturity and an omitted due date', async () => {
    const { service, tx } = fixture();
    await service.create({ ...dto, dueAt: dto.issuedAt }, 'actor', 'org-a');
    await service.create({ ...dto, dueAt: undefined }, 'actor', 'org-a');
    expect(tx.moneyLoan.create).toHaveBeenLastCalledWith(
      objectContaining({
        data: objectContaining({ dueAt: null }),
      }),
    );
  });
});

describe('LoansService tenant reads', () => {
  it.each(['MONEY', 'SERVICE'])(
    'filters %s inside tenant and pagination bounds',
    async (type) => {
      const { service, tx } = fixture();
      const rows = [
        { id: 'a', organizationId: 'org-a', type: 'SERVICE' },
        { id: 'b', organizationId: 'org-b', type: 'SERVICE' },
        { id: 'c', organizationId: 'org-a', type: 'MONEY' },
      ].map((row) => ({
        ...row,
        amount: new Prisma.Decimal('120.25'),
        events: [],
      }));
      type Filter = { where: { organizationId: string; type?: string } };
      const matches = ({ where }: Filter) =>
        rows.filter(
          (row) =>
            row.organizationId === where.organizationId &&
            (!where.type || row.type === where.type),
        );
      tx.moneyLoan.findMany.mockImplementation(
        (args: Filter & { skip: number; take: number }) =>
          Promise.resolve(
            matches(args).slice(args.skip, args.skip + args.take),
          ),
      );
      tx.moneyLoan.count.mockImplementation((args: Filter) =>
        Promise.resolve(matches(args).length),
      );
      const result = await service.findAll(
        { type, limit: 1000, organizationId: 'org-b' } as QueryLoansDto,
        'org-a',
      );
      expect(result.total).toBe(1);
      expect(result.limit).toBe(100);
      expect(result.data).toEqual([
        expect.objectContaining({ type, organizationId: 'org-a' }),
      ]);
      expect(tx.moneyLoan.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-a', type },
      });
      tx.moneyLoan.findFirst.mockResolvedValue(
        matches({ where: { organizationId: 'org-a', type } })[0],
      );
      await expect(service.findOne('a', 'org-a')).resolves.toMatchObject({
        type,
      });
    },
  );

  it('scopes list and count and bounds pagination', async () => {
    const { service, tx } = fixture();
    const rows = [
      {
        id: 'loan-a',
        organizationId: 'org-a',
        amount: new Prisma.Decimal('120.25'),
        status: 'OPEN',
        events: [],
      },
      {
        id: 'loan-b',
        organizationId: 'org-b',
        amount: new Prisma.Decimal('120.25'),
        status: 'OPEN',
        events: [],
      },
    ];
    type Filter = { where: { organizationId: string } };
    tx.moneyLoan.findMany.mockImplementation(
      ({ where, skip, take }: Filter & { skip: number; take: number }) =>
        Promise.resolve(
          rows
            .filter((row) => row.organizationId === where.organizationId)
            .slice(skip, skip + take),
        ),
    );
    tx.moneyLoan.count.mockImplementation(({ where }: Filter) =>
      Promise.resolve(
        rows.filter((row) => row.organizationId === where.organizationId)
          .length,
      ),
    );
    expect(await service.findAll({}, 'org-a')).toEqual({
      data: [
        {
          id: 'loan-a',
          organizationId: 'org-a',
          amount: rows[0].amount,
          status: 'OPEN',
          balance: '120.25',
          collected: '0.00',
          paymentStatus: 'UNPAID',
          posFinancing: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(await service.findAll({ page: 2, limit: 10 }, 'org-a')).toEqual({
      data: [],
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });
    expect(tx.moneyLoan.findMany).toHaveBeenLastCalledWith(
      objectContaining({
        where: { organizationId: 'org-a' },
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(tx.moneyLoan.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
    });
    await service.findAll({ limit: 1000 }, 'org-a');
    expect(tx.moneyLoan.findMany).toHaveBeenLastCalledWith(
      objectContaining({ take: 100 }),
    );
  });

  it.each(['missing', 'foreign'])(
    'returns 404 for %s detail and history',
    async (state) => {
      const { service, tx } = fixture();
      const foreign = { id: 'loan-b', organizationId: 'org-b' };
      tx.moneyLoan.findFirst.mockImplementation(
        ({ where }: { where: { id: string; organizationId: string } }) =>
          Promise.resolve(
            state !== 'missing' &&
              where.id === foreign.id &&
              where.organizationId === foreign.organizationId
              ? foreign
              : null,
          ),
      );
      await expect(service.findOne('loan-b', 'org-a')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getHistory('loan-b', {}, 'org-a')).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.moneyLoan.findFirst).toHaveBeenCalledWith(
        objectContaining({
          where: { id: 'loan-b', organizationId: 'org-a' },
        }),
      );
      expect(tx.moneyLoanEvent.findMany).not.toHaveBeenCalled();
    },
  );

  it.each([{ finalSaleId: 'sale' }, { finalSaleId: null }])(
    'projects POS financing with finalSaleId $finalSaleId on list and detail',
    async ({ finalSaleId }) => {
      const { service, tx } = fixture();
      const loan = {
        id: 'loan',
        organizationId: 'org-a',
        amount: new Prisma.Decimal('120.25'),
        status: 'OPEN',
        events: [],
        posLoanSaleIntent: { id: 'intent', finalSaleId },
      };
      const expected = {
        id: 'loan',
        organizationId: 'org-a',
        amount: new Prisma.Decimal('120.25'),
        status: 'OPEN',
        balance: '120.25',
        collected: '0.00',
        paymentStatus: 'UNPAID',
        posFinancing: { intentId: 'intent', finalSaleId },
      };
      tx.moneyLoan.findFirst.mockResolvedValue(loan);
      tx.moneyLoan.findMany.mockResolvedValue([loan]);
      tx.moneyLoan.count.mockResolvedValue(1);
      expect(await service.findOne('loan', 'org-a')).toEqual(expected);
      expect(await service.findAll({}, 'org-a')).toEqual({
        data: [expected],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(tx.moneyLoan.findMany).toHaveBeenCalledWith(
        objectContaining({
          select: objectContaining({
            posLoanSaleIntent: { select: { id: true, finalSaleId: true } },
          }),
        }),
      );
    },
  );

  it('scopes and paginates history with safe actor projection', async () => {
    const { service, tx } = fixture();
    tx.moneyLoan.findFirst.mockResolvedValue({
      id: 'loan',
      amount: new Prisma.Decimal('120.25'),
      status: 'OPEN',
      events: [],
    });
    expect(await service.findOne('loan', 'org-a')).toEqual({
      id: 'loan',
      amount: new Prisma.Decimal('120.25'),
      status: 'OPEN',
      balance: '120.25',
      collected: '0.00',
      paymentStatus: 'UNPAID',
      posFinancing: null,
    });
    await service.getHistory('loan', { page: 2, limit: 5 }, 'org-a');
    expect(tx.moneyLoanEvent.findMany).toHaveBeenCalledWith(
      objectContaining({
        where: { loanId: 'loan', organizationId: 'org-a' },
        skip: 5,
        take: 5,
        select: objectContaining({
          createdBy: { select: { id: true, name: true } },
        }),
      }),
    );
    expect(tx.moneyLoanEvent.count).toHaveBeenCalledWith({
      where: { loanId: 'loan', organizationId: 'org-a' },
    });
  });

  it('ignores a query tenant selector for normal scoped reads', async () => {
    const { service, tx } = fixture();
    await service.findAll({ organizationId: 'org-b' }, 'org-a');
    expect(tx.moneyLoan.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
    });
  });

  it('fails closed without organization scope', async () => {
    const { service, prisma } = fixture();
    await expect(service.create(dto, 'actor', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.findAll({}, undefined)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.findOne('loan', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.getHistory('loan', {}, undefined)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
