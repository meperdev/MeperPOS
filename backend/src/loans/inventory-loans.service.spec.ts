import { ConflictException, ValidationPipe } from '@nestjs/common';
import {
  InventoryLoanOperation,
  MovementType,
  OrgRole,
  Prisma,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryLoanDto } from './dto/create-inventory-loan.dto';
import { CounterpartyType } from './dto/create-loan.dto';
import {
  InventoryLoanOperationDto,
  InventoryLoanTerminalDto,
} from './dto/inventory-loan-operation.dto';
import { InventoryLoansService } from './inventory-loans.service';

const p1 = '00000000-0000-4000-8000-000000000001';
const p2 = '00000000-0000-4000-8000-000000000003';
const personId = '00000000-0000-4000-8000-000000000002';
const actor: RequestUser = {
  userId: 'actor',
  organizationId: 'org',
  role: OrgRole.ADMIN,
  email: 'unused',
  tokenVersion: 0,
  isSuperAdmin: false,
};
const dto: CreateInventoryLoanDto = {
  requestKey: 'create-1',
  counterpartyType: CounterpartyType.CUSTOMER,
  counterpartyId: personId,
  items: [{ productId: p1, quantity: 2 }],
};
type Row = Record<string, unknown>;
type Product = {
  id: string;
  organizationId: string;
  active: boolean;
  type: string;
  tracksStock: boolean;
  stock: number;
  reservedStock: number;
  version: number;
};
type Item = {
  id: string;
  loanId: string;
  productId: string;
  organizationId: string;
  quantity: number;
  deliveredQuantity: number;
  returnedQuantity: number;
  cancelledQuantity: number;
};
type Loan = {
  id: string;
  organizationId: string;
  createdById: string;
  createdAt: Date;
  status: 'OPEN' | 'CANCELLED' | 'CLOSED';
  version: number;
  customerId: string | null;
  supplierId: string | null;
  employeeId: string | null;
  items: Item[];
};
type State = {
  products: Product[];
  members: Row[];
  customers: Row[];
  suppliers: Row[];
  loans: Loan[];
  operations: InventoryLoanOperation[];
  events: Row[];
  movements: Row[];
  audits: Row[];
};
// Predicate-aware local store, NOT a PostgreSQL simulator. Commit only on success.
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key];
    if (value && typeof value === 'object') {
      const filter = value as Row;
      if ('in' in filter) return (filter.in as unknown[]).includes(actual);
      if ('gte' in filter || 'equals' in filter) {
        return (
          (!('equals' in filter) || actual === filter.equals) &&
          (!('gte' in filter) || (actual as number) >= (filter.gte as number))
        );
      }
      return !!actual && matches(actual as Row, filter);
    }
    return value === undefined || actual === value;
  });
}
function harness() {
  let state: State = {
    products: [p1, p2].map((id) => ({
      id,
      organizationId: 'org',
      active: true,
      type: 'PRODUCT',
      tracksStock: true,
      stock: 10,
      reservedStock: 1,
      version: 7,
    })),
    members: ['actor', 'other', personId].map((userId) => ({
      userId,
      organizationId: 'org',
      role: 'ADMIN',
      user: { active: true },
    })),
    customers: [{ id: personId, organizationId: 'org', active: true }],
    suppliers: [{ id: personId, organizationId: 'org', active: true }],
    loans: [],
    operations: [],
    events: [],
    movements: [],
    audits: [],
  };
  let working = state;
  let fail: string | undefined;
  let transactionError: Error | undefined;
  const calls: string[] = [];
  const operationLookupPhases: string[] = [];
  let inTransaction = false;
  const find = (table: 'members' | 'customers' | 'suppliers' | 'products') =>
    jest.fn(
      ({ where }: { where: Row }) =>
        working[table].find((row) => matches(row, where)) ?? null,
    );
  const operationFind = jest.fn(
    ({ where }: Prisma.InventoryLoanOperationFindUniqueArgs) => {
      operationLookupPhases.push(inTransaction ? 'inside' : 'outside');
      const key = where.organizationId_requestKey!;
      return (
        working.operations.find(
          (op) =>
            op.organizationId === key.organizationId &&
            op.requestKey === key.requestKey,
        ) ?? null
      );
    },
  );
  const scopedLoan = (
    loan: Loan,
    select: Prisma.InventoryLoanSelect | null | undefined,
  ) => {
    const relation = select?.items as { where?: Row; select?: Row };
    const { version, ...publicLoan } = loan;
    return {
      ...publicLoan,
      ...(select?.version ? { version } : {}),
      items: loan.items
        .filter((item) => matches(item, relation.where ?? {}))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((item) => {
          const { organizationId, loanId, ...data } = item;
          void organizationId;
          void loanId;
          return {
            ...data,
            ...(relation.select?.organizationId ? { organizationId } : {}),
            ...(relation.select?.loanId ? { loanId } : {}),
          };
        }),
    };
  };
  const loanFind = jest.fn(
    ({ where, select }: Prisma.InventoryLoanFindFirstArgs) => {
      const loan = working.loans.find((row) => matches(row, where as Row));
      return loan ? scopedLoan(loan, select) : null;
    },
  );
  const loanMany = jest.fn(
    ({ where, select, skip, take }: Prisma.InventoryLoanFindManyArgs) =>
      working.loans
        .filter((row) => matches(row, where as Row))
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .slice(skip, (skip ?? 0) + (take ?? 20))
        .map((row) => scopedLoan(row, select)),
  );
  const loanCount = jest.fn(
    ({ where }: Prisma.InventoryLoanCountArgs) =>
      working.loans.filter((row) => matches(row, where as Row)).length,
  );
  const update = jest.fn(({ where, data }: Prisma.ProductUpdateManyArgs) => {
    calls.push('reserve');
    if (fail === 'cas' || (fail === 'later-product' && where?.id === p2))
      return { count: 0 };
    if (fail === 'product-throw') throw new Error('product failure');
    const product = working.products.find((row) => matches(row, where as Row));
    if (!product) return { count: 0 };
    if (data.reservedStock)
      product.reservedStock += (
        data.reservedStock as { increment: number }
      ).increment;
    if (data.stock)
      product.stock += (data.stock as { increment: number }).increment;
    product.version += (data.version as { increment: number }).increment;
    return { count: 1 };
  });
  const loanCreate = jest.fn(
    ({ data, select }: Prisma.InventoryLoanCreateArgs) => {
      calls.push('loan');
      const items = data.items!.create as Array<{
        productId: string;
        quantity: number;
        organizationId: string;
      }>;
      const loan: Loan = {
        id: `loan-${working.loans.length}`,
        organizationId: data.organizationId!,
        createdById: data.createdById!,
        createdAt: new Date('2026-10-09T00:00:00Z'),
        status: 'OPEN',
        version: 0,
        customerId: data.customerId ?? null,
        supplierId: data.supplierId ?? null,
        employeeId: data.employeeId ?? null,
        items: items.map((item, index) => ({
          ...item,
          id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
          loanId: `loan-${working.loans.length}`,
          deliveredQuantity: 0,
          returnedQuantity: 0,
          cancelledQuantity: 0,
        })),
      };
      working.loans.push(loan);
      return scopedLoan(loan, select);
    },
  );
  const loanUpdate = jest.fn(
    ({ where, data }: Prisma.InventoryLoanUpdateManyArgs) => {
      calls.push('claim');
      if (fail === 'claim') return { count: 0 };
      if (fail === 'claim-throw') throw new Error('loan failure');
      const row = working.loans.find((row) => matches(row, where as Row));
      if (!row) return { count: 0 };
      row.version += (data.version as { increment: number }).increment;
      if (typeof data.status === 'string') row.status = data.status;
      return { count: 1 };
    },
  );
  const itemUpdate = jest.fn(
    ({ where, data }: Prisma.InventoryLoanItemUpdateManyArgs) => {
      calls.push('item');
      if (
        fail === 'item' ||
        (fail === 'later-item' &&
          typeof where?.id === 'string' &&
          where.id.endsWith('101'))
      )
        return { count: 0 };
      if (fail === 'item-throw') throw new Error('item failure');
      const row = working.loans
        .flatMap((loan) => loan.items)
        .find((row) => matches(row, where as Row));
      if (!row) return { count: 0 };
      if (data.deliveredQuantity)
        row.deliveredQuantity += (
          data.deliveredQuantity as { increment: number }
        ).increment;
      if (data.returnedQuantity)
        row.returnedQuantity += (
          data.returnedQuantity as { increment: number }
        ).increment;
      if (data.cancelledQuantity)
        row.cancelledQuantity += (
          data.cancelledQuantity as { increment: number }
        ).increment;
      return { count: 1 };
    },
  );
  const operationCreate = jest.fn(
    ({ data }: Prisma.InventoryLoanOperationCreateArgs) => {
      calls.push('operation');
      if (fail === 'operation') throw new Error('operation failure');
      const op = {
        ...data,
        id: `op-${working.operations.length}`,
        createdAt: new Date(),
      } as InventoryLoanOperation;
      working.operations.push(op);
      return op;
    },
  );
  const eventCreate = jest.fn(
    ({ data }: Prisma.InventoryLoanEventCreateArgs) => {
      calls.push('event');
      if (
        fail === 'event' ||
        (fail === 'header-event' && data.itemId === null) ||
        (fail === 'later-event' &&
          typeof data.itemId === 'string' &&
          data.itemId.endsWith('101'))
      )
        throw new Error('event failure');
      const op = working.operations.find(
        (op) =>
          op.id === data.operationId &&
          op.loanId === data.loanId &&
          op.organizationId === data.organizationId &&
          op.actorId === data.createdById,
      );
      if (!op) throw new Error('missing correlated operation');
      const row = {
        ...data,
        id: `event-${working.events.length}`,
        createdAt: new Date(),
        itemId: data.itemId ?? null,
        quantity: data.quantity ?? null,
      };
      working.events.push(row);
      return row;
    },
  );
  const movementCreate = jest.fn(
    ({ data }: Prisma.InventoryMovementCreateArgs) => {
      calls.push('movement');
      const event = working.events.find(
        (row) => row.id === data.inventoryLoanEventId,
      );
      const item = working.loans
        .flatMap((loan) => loan.items)
        .find(
          (row) =>
            row.id === event?.itemId &&
            row.loanId === event?.loanId &&
            row.organizationId === event?.organizationId,
        );
      const operation = working.operations.find(
        (row) => row.id === event?.operationId,
      );
      const delivery = data.type === MovementType.LOAN_DELIVERY;
      if (
        !event ||
        !item ||
        !operation ||
        (data.type !== MovementType.LOAN_DELIVERY &&
          data.type !== MovementType.LOAN_RETURN) ||
        data.saleId !== null ||
        data.userId !== event.createdById ||
        data.userId !== operation.actorId ||
        data.organizationId !== event.organizationId ||
        item.organizationId !== event.organizationId ||
        item.loanId !== event.loanId ||
        operation.loanId !== event.loanId ||
        operation.organizationId !== event.organizationId ||
        data.productId !== item.productId ||
        event.type !== (delivery ? 'DELIVERED' : 'RETURNED') ||
        operation.type !== (delivery ? 'DELIVER' : 'RETURN') ||
        typeof event.quantity !== 'number' ||
        event.quantity <= 0 ||
        data.quantity !== (delivery ? -event.quantity : event.quantity) ||
        data.previousStock < 0 ||
        data.newStock < 0 ||
        data.newStock - data.previousStock !== data.quantity
      )
        throw new Error('invalid loan movement');
      if (
        working.movements.some((row) => row.inventoryLoanEventId === event.id)
      )
        throw new Error('duplicate event movement');
      if (
        fail === 'movement' ||
        (fail === 'later-movement' && item.id.endsWith('101'))
      )
        throw new Error('movement failure');
      const row = { ...data, id: `movement-${working.movements.length}` };
      working.movements.push(row);
      return row;
    },
  );
  const auditCreate = jest.fn(({ data }: Prisma.AuditLogCreateArgs) => {
    calls.push('audit');
    if (fail === 'audit') throw new Error('audit failure');
    working.audits.push(data as Row);
    return data;
  });
  const eventMany = jest.fn(
    ({ where, skip, take }: Prisma.InventoryLoanEventFindManyArgs) =>
      working.events
        .filter((row) => matches(row, where as Row))
        .sort(
          (a, b) =>
            (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() ||
            String(a.id).localeCompare(String(b.id)),
        )
        .slice(skip, (skip ?? 0) + (take ?? 20))
        .map((row) => {
          const { operationId, organizationId, ...publicRow } = row;
          void operationId;
          void organizationId;
          return publicRow;
        }),
  );
  const eventCount = jest.fn(
    ({ where }: Prisma.InventoryLoanEventCountArgs) =>
      working.events.filter((row) => matches(row, where as Row)).length,
  );
  const forbiddenWrite = jest.fn(() => {
    throw new Error('forbidden financial/physical write');
  });
  const db = {
    organizationUser: { findFirst: find('members') },
    customer: { findFirst: find('customers') },
    supplier: { findFirst: find('suppliers') },
    product: { findFirst: find('products'), updateMany: update },
    inventoryLoan: {
      create: loanCreate,
      findFirst: loanFind,
      findMany: loanMany,
      count: loanCount,
      updateMany: loanUpdate,
    },
    inventoryLoanItem: { updateMany: itemUpdate },
    inventoryLoanOperation: {
      findUnique: operationFind,
      create: operationCreate,
    },
    inventoryLoanEvent: {
      create: eventCreate,
      findMany: eventMany,
      count: eventCount,
    },
    auditLog: { create: auditCreate },
    inventoryMovement: { create: movementCreate },
    sale: { create: forbiddenWrite },
    payment: { create: forbiddenWrite },
    moneyLoan: { create: forbiddenWrite },
    $transaction: jest.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        working = structuredClone(state);
        inTransaction = true;
        try {
          const result = await callback(
            db as unknown as Prisma.TransactionClient,
          );
          if (transactionError) throw transactionError;
          state = working;
          return result;
        } finally {
          working = state;
          inTransaction = false;
        }
      },
    ),
  };
  return {
    db,
    calls,
    operationLookupPhases,
    service: new InventoryLoansService(db as unknown as PrismaService),
    state: () => state,
    fail: (name: string) => {
      fail = name;
    },
    transactionError: (error: Error) => {
      transactionError = error;
    },
  };
}

describe('unwired inventory creation', () => {
  it('rejects missing organization before any reservation', async () => {
    const h = harness();
    await expect(
      h.service.create(dto, { ...actor, organizationId: undefined }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects duplicate products instead of silently merging', async () => {
    const h = harness();
    await expect(
      h.service.create({ ...dto, items: [...dto.items, ...dto.items] }, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it('reserves sorted multiple products without physical stock changes; completes operation before event/audit', async () => {
    const h = harness();
    const result = await h.service.create(
      { ...dto, items: [{ productId: p2, quantity: 3 }, ...dto.items] },
      actor,
    );
    expect(
      h.state().products.map((p) => [p.stock, p.reservedStock, p.version]),
    ).toEqual([
      [10, 3, 8],
      [10, 4, 8],
    ]);
    expect(
      h.db.product.updateMany.mock.calls.map(([arg]) => arg.where!.id),
    ).toEqual([p1, p2]);
    expect(h.db.product.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: p1,
        organizationId: 'org',
        active: true,
        type: 'PRODUCT',
        tracksStock: true,
        version: 7,
        reservedStock: 1,
        stock: { equals: 10, gte: 3 },
      },
      data: { reservedStock: { increment: 2 }, version: { increment: 1 } },
    });
    expect(h.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(result.items[0]).toMatchObject({
      quantity: 2,
      reservedRemaining: 2,
      outstanding: 0,
    });
    expect(result.createdAt).toBe('2026-10-09T00:00:00.000Z');
    expect(h.calls).toEqual([
      'reserve',
      'reserve',
      'loan',
      'operation',
      'event',
      'audit',
    ]);
    expect(h.state().operations[0].resultSnapshot).toEqual(result);
    expect(h.db.inventoryLoanEvent.create).toHaveBeenCalledWith({
      data: {
        loanId: result.id,
        organizationId: 'org',
        createdById: 'actor',
        type: 'CREATED',
        operationId: 'op-0',
      },
    });
    expect(h.db.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org',
        userId: 'actor',
        action: 'INVENTORY_LOAN_CREATED',
        resource: 'InventoryLoan',
        resourceId: result.id,
        metadata: { operationId: 'op-0' },
      },
    });
    expect(h.db.inventoryMovement.create).not.toHaveBeenCalled();
    expect(h.db.sale.create).not.toHaveBeenCalled();
    expect(h.db.payment.create).not.toHaveBeenCalled();
    expect(h.db.moneyLoan.create).not.toHaveBeenCalled();
  });
  it.each([OrgRole.MEMBER, OrgRole.CASHIER, OrgRole.INVENTORY_USER])(
    'rejects authenticated role %s',
    async (role) => {
      const h = harness();
      await expect(
        h.service.create(dto, { ...actor, role }),
      ).rejects.toMatchObject({ status: 403 });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['inactive', 'tenant', 'role', 'absent'])(
    'rejects %s actor membership',
    async (kind) => {
      const h = harness();
      const member = h.state().members[0];
      if (kind === 'inactive') member.user = { active: false };
      if (kind === 'tenant') member.organizationId = 'other';
      if (kind === 'role') member.role = 'MEMBER';
      if (kind === 'absent') h.state().members.splice(0, 1);
      await expect(
        h.service.create(dto, { ...actor, role: 'SUPER_ADMIN' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(h.calls).toEqual([]);
    },
  );
  it.each([OrgRole.OWNER, 'SUPER_ADMIN' as const])(
    'allows %s only with real administrative membership',
    async (role) => {
      const h = harness();
      await expect(
        h.service.create(dto, { ...actor, role }),
      ).resolves.toMatchObject({ createdById: actor.userId });
    },
  );
  it.each(Object.values(CounterpartyType))(
    'validates active same-tenant %s',
    async (counterpartyType) => {
      const h = harness();
      const result = await h.service.create(
        { ...dto, counterpartyType },
        actor,
      );
      const key =
        counterpartyType === CounterpartyType.CUSTOMER
          ? 'customerId'
          : counterpartyType === CounterpartyType.SUPPLIER
            ? 'supplierId'
            : 'employeeId';
      expect(result[key]).toBe(personId);
      expect(
        [result.customerId, result.supplierId, result.employeeId].filter(
          Boolean,
        ),
      ).toEqual([personId]);
    },
  );
  it.each(
    Object.values(CounterpartyType).flatMap((type) =>
      ['inactive', 'tenant', 'absent'].map((kind) => [type, kind] as const),
    ),
  )('rejects %s counterparty %s', async (counterpartyType, kind) => {
    const h = harness();
    const table =
      counterpartyType === CounterpartyType.CUSTOMER
        ? h.state().customers
        : counterpartyType === CounterpartyType.SUPPLIER
          ? h.state().suppliers
          : h.state().members;
    const row = table.find((row) => (row.id ?? row.userId) === personId)!;
    if (kind === 'inactive') {
      if (counterpartyType === CounterpartyType.EMPLOYEE)
        row.user = { active: false };
      else row.active = false;
    }
    if (kind === 'tenant') row.organizationId = 'other';
    if (kind === 'absent') table.splice(table.indexOf(row), 1);
    await expect(
      h.service.create({ ...dto, counterpartyType }, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.calls).toEqual([]);
  });
  it.each([
    { type: 'SERVICE' },
    { tracksStock: false },
    { active: false },
    { organizationId: 'other' },
  ])('rejects ineligible product %j', async (patch) => {
    const h = harness();
    Object.assign(h.state().products[0], patch);
    await expect(h.service.create(dto, actor)).rejects.toMatchObject({
      status: 400,
    });
    expect(h.calls).toEqual([]);
  });
  it.each([
    { stock: 2 },
    { reservedStock: 11 },
    { reservedStock: undefined },
    { stock: -1 },
    { version: undefined },
    { version: 2147483647 },
  ])('fails closed on insufficient/inconsistent controls %j', async (patch) => {
    const h = harness();
    Object.assign(h.state().products[0], patch);
    await expect(h.service.create(dto, actor)).rejects.toMatchObject({
      status: 409,
    });
    expect(h.calls).toEqual([]);
  });
  it.each([0, -1, 1.1, '2', null, true, 2147483648, NaN, Infinity])(
    'rejects raw quantity %s directly and in DTO',
    async (quantity) => {
      const h = harness();
      const input = { ...dto, items: [{ productId: p1, quantity }] };
      expect(
        validateSync(
          plainToInstance(CreateInventoryLoanDto, input, {
            enableImplicitConversion: true,
          }),
        ).length,
      ).toBeGreaterThan(0);
      await expect(
        h.service.create(input as CreateInventoryLoanDto, actor),
      ).rejects.toMatchObject({ status: 400 });
      expect(h.calls).toEqual([]);
    },
  );
  it.each([
    { requestKey: ' ' },
    { requestKey: 'x'.repeat(101) },
    { requestKey: 123 },
    { counterpartyId: 'bad' },
    { counterpartyType: 'OTHER' },
    { items: [] },
    { items: null },
    { items: Array.from({ length: 101 }, () => dto.items[0]) },
    { customerId: personId },
    { actorId: 'other' },
    { organizationId: 'other' },
    { dueAt: '2026-10-10' },
    ...[
      'unitPrice',
      'taxRate',
      'cost',
      'stock',
      'reservedStock',
      'version',
    ].map((key) => ({ items: [{ ...dto.items[0], [key]: 1 }] })),
  ])('rejects invalid or unknown DTO fields %j', async (patch) => {
    const h = harness();
    await expect(
      h.service.create({ ...dto, ...patch } as CreateInventoryLoanDto, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.calls).toEqual([]);
  });
  it.each(['operation', 'event', 'audit', 'cas'])(
    'rolls back all staged local stores on %s failure',
    async (failure) => {
      const h = harness();
      const before = structuredClone(h.state());
      h.fail(failure);
      await expect(
        h.service.create(
          { ...dto, items: [...dto.items, { productId: p2, quantity: 2 }] },
          actor,
        ),
      ).rejects.toBeDefined();
      expect(h.state()).toEqual(before);
    },
  );
  it('rolls back an earlier reservation when a later product is unavailable', async () => {
    const h = harness();
    h.state().products[1].stock = 1;
    const before = structuredClone(h.state());
    await expect(
      h.service.create(
        { ...dto, items: [...dto.items, { productId: p2, quantity: 2 }] },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.calls).toEqual(['reserve']);
    expect(h.state()).toEqual(before);
  });
  it('replays normalized key/order from immutable snapshot after live loan/entities change without effects', async () => {
    const h = harness();
    const input = {
      ...dto,
      items: [...dto.items, { productId: p2, quantity: 2 }],
    };
    const result = await h.service.create(input, actor);
    h.state().loans[0].status = 'CANCELLED';
    h.state().loans[0].items[0].deliveredQuantity = 1;
    h.state().customers[0].active = false;
    const effects = [...h.calls];
    expect(
      await h.service.create(
        {
          ...input,
          requestKey: ' create-1 ',
          items: [...input.items].reverse(),
        },
        actor,
      ),
    ).toEqual(result);
    expect(h.calls).toEqual(effects);
    expect(h.state().operations).toHaveLength(1);
  });
  it.each(['actor', 'quantity', 'counterparty', 'type'])(
    'rejects replay %s mismatch before writes',
    async (mismatch) => {
      const h = harness();
      await h.service.create(dto, actor);
      const effects = [...h.calls];
      const changed = { ...dto };
      if (mismatch === 'quantity')
        changed.items = [{ productId: p1, quantity: 3 }];
      if (mismatch === 'counterparty')
        changed.counterpartyType = CounterpartyType.SUPPLIER;
      if (mismatch === 'type')
        h.state().operations[0].type =
          'OTHER' as InventoryLoanOperation['type'];
      await expect(
        h.service.create(
          changed,
          mismatch === 'actor' ? { ...actor, userId: 'other' } : actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual(effects);
    },
  );
  it.each([null, {}, { id: 'wrong' }, { password: 'never-public' }])(
    'fails closed on malformed snapshot %j',
    async (resultSnapshot) => {
      const h = harness();
      await h.service.create(dto, actor);
      h.state().operations[0].resultSnapshot =
        resultSnapshot as Prisma.JsonValue;
      const effects = [...h.calls];
      await expect(h.service.create(dto, actor)).rejects.toMatchObject({
        status: 409,
      });
      expect(h.calls).toEqual(effects);
    },
  );
  it('rejects an otherwise-valid snapshot with a valid customer and empty supplier', async () => {
    const h = harness();
    await h.service.create(dto, actor);
    const stored = h.state().operations[0].resultSnapshot as unknown as Row;
    stored.supplierId = '';
    expect(stored.customerId).toBe(personId);
    expect(stored.employeeId).toBeNull();
    const before = structuredClone(h.state());
    const effects = [...h.calls];
    await expect(h.service.create(dto, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.state()).toEqual(before);
    expect(h.calls).toEqual(effects);
    expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
  });
  it.each(
    (
      [
        [CounterpartyType.CUSTOMER, 'customerId'],
        [CounterpartyType.SUPPLIER, 'supplierId'],
        [CounterpartyType.EMPLOYEE, 'employeeId'],
      ] as const
    ).flatMap(([counterpartyType, selected]) =>
      (['customerId', 'supplierId', 'employeeId'] as const).flatMap((field) =>
        (field === selected
          ? ['', ' \t ', undefined, 17, null]
          : ['', ' \t ', undefined, 17, personId]
        ).map((value) => ({ counterpartyType, field, value })),
      ),
    ),
  )(
    'rejects otherwise-valid counterparty snapshot corruption %j',
    async ({ counterpartyType, field, value }) => {
      const h = harness();
      const request = { ...dto, counterpartyType };
      await h.service.create(request, actor);
      const stored = h.state().operations[0].resultSnapshot as unknown as Row;
      stored[field] = value;
      const before = structuredClone(h.state());
      const effects = [...h.calls];
      await expect(h.service.create(request, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.state()).toEqual(before);
      expect(h.calls).toEqual(effects);
      expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(Object.values(CounterpartyType))(
    'preserves valid %s stored replay without effects',
    async (counterpartyType) => {
      const h = harness();
      const request = { ...dto, counterpartyType };
      const created = await h.service.create(request, actor);
      const before = structuredClone(h.state());
      const effects = [...h.calls];
      expect(await h.service.create(request, actor)).toEqual(created);
      expect(h.state()).toEqual(before);
      expect(h.calls).toEqual(effects);
      expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
    },
  );
  it('uses independent tenant key namespace without cross-tenant lookup or reservation', async () => {
    const h = harness();
    await h.service.create(dto, actor);
    h.state().members.push({
      ...h.state().members[0],
      organizationId: 'org-2',
    });
    h.state().customers.push({
      ...h.state().customers[0],
      organizationId: 'org-2',
    });
    h.state().products.push({
      ...h.state().products[0],
      organizationId: 'org-2',
      reservedStock: 0,
    });
    const second = await h.service.create(dto, {
      ...actor,
      organizationId: 'org-2',
    });
    expect(second.organizationId).toBe('org-2');
    expect(h.state().operations).toHaveLength(2);
    expect(h.state().products[0].reservedStock).toBe(3);
    expect(h.db.inventoryLoanOperation.findUnique).toHaveBeenLastCalledWith({
      where: {
        organizationId_requestKey: {
          organizationId: 'org-2',
          requestKey: dto.requestKey,
        },
      },
    });
  });
  it.each(['P2002', 'P2034'])(
    'reconciles %s only outside aborted transaction',
    async (code) => {
      const h = harness();
      const result = await h.service.create(dto, actor);
      h.transactionError(
        new Prisma.PrismaClientKnownRequestError('race', {
          code,
          clientVersion: 'test',
        }),
      );
      const before = structuredClone(h.state());
      expect(await h.service.create(dto, actor)).toEqual(result);
      expect(h.state()).toEqual(before);
      expect(h.db.inventoryLoanOperation.findUnique).toHaveBeenCalledTimes(3);
    },
  );
  it.each(['P2002', 'P2034'])(
    'returns 409 on %s without matching completed operation and never retries',
    async (code) => {
      const h = harness();
      const before = structuredClone(h.state());
      h.transactionError(
        new Prisma.PrismaClientKnownRequestError('race', {
          code,
          clientVersion: 'test',
        }),
      );
      await expect(h.service.create(dto, actor)).rejects.toMatchObject({
        status: 409,
      });
      expect(h.state()).toEqual(before);
      expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    },
  );
});

describe('internal inventory delivery and return', () => {
  it('returns previously delivered units without restoring a consumed reservation', async () => {
    const h = harness();
    const loan = await h.service.create(dto, actor);
    h.state().loans[0].items[0].deliveredQuantity = 2;
    Object.assign(h.state().products[0], { stock: 8, reservedStock: 1 });
    await expect(
      h.service.returnItems(
        loan.id,
        {
          requestKey: 'return-1',
          items: [{ itemId: loan.items[0].id, quantity: 1 }],
        },
        actor,
      ),
    ).resolves.toMatchObject({
      items: [{ returnedQuantity: 1, outstanding: 1 }],
    });
    expect(h.state().products[0]).toMatchObject({ stock: 9, reservedStock: 1 });
  });
  it('delivers reserved units and restores only physical stock on return, without closing', async () => {
    const h = harness();
    const loan = await h.service.create(dto, actor);
    const input = {
      requestKey: 'deliver-1',
      items: [{ itemId: loan.items[0].id, quantity: 2 }],
    };
    await expect(
      h.service.deliver(loan.id, input, actor),
    ).resolves.toMatchObject({
      status: 'OPEN',
      items: [{ deliveredQuantity: 2, outstanding: 2, reservedRemaining: 0 }],
    });
    expect(h.state().products[0]).toMatchObject({ stock: 8, reservedStock: 1 });
    await expect(
      h.service.returnItems(
        loan.id,
        { ...input, requestKey: 'return-1' },
        actor,
      ),
    ).resolves.toMatchObject({
      status: 'OPEN',
      items: [{ deliveredQuantity: 2, returnedQuantity: 2, outstanding: 0 }],
    });
    expect(h.state().products[0]).toMatchObject({
      stock: 10,
      reservedStock: 1,
    });
  });
});

describe.each(['deliver', 'returnItems'] as const)(
  'internal %s contract',
  (method) => {
    async function prepare(
      multi = false,
      counterpartyType = CounterpartyType.CUSTOMER,
    ) {
      const h = harness();
      const loan = await h.service.create(
        {
          ...dto,
          counterpartyType,
          items: multi
            ? [...dto.items, { productId: p2, quantity: 2 }]
            : dto.items,
        },
        actor,
      );
      if (method === 'returnItems') {
        await h.service.deliver(
          loan.id,
          {
            requestKey: 'setup-delivery',
            items: loan.items.map((item) => ({ itemId: item.id, quantity: 2 })),
          },
          actor,
        );
      }
      h.calls.length = 0;
      h.operationLookupPhases.length = 0;
      jest.clearAllMocks();
      return {
        h,
        loan,
        input: {
          requestKey: 'operation-1',
          items: loan.items.map((item) => ({ itemId: item.id, quantity: 1 })),
        },
      };
    }
    it('uses sorted item/product CAS, one loan claim and completed operation before correlated item events and audit', async () => {
      const { h, loan, input } = await prepare(true);
      const result = await h.service[method](
        loan.id,
        { ...input, items: [...input.items].reverse() },
        { ...actor, userId: 'other' },
      );
      expect(result.createdById).toBe('actor');
      expect(h.state().loans[0].version).toBe(method === 'deliver' ? 1 : 2);
      expect(h.calls).toEqual([
        'claim',
        'item',
        'item',
        'reserve',
        'reserve',
        'operation',
        'event',
        'movement',
        'event',
        'movement',
        'audit',
      ]);
      expect(h.db.inventoryLoan.updateMany).toHaveBeenCalledTimes(1);
      expect(h.db.inventoryLoan.updateMany).toHaveBeenCalledWith({
        where: {
          id: loan.id,
          organizationId: 'org',
          status: 'OPEN',
          version: method === 'deliver' ? 0 : 1,
        },
        data: { version: { increment: 1 } },
      });
      expect(
        h.db.inventoryLoanItem.updateMany.mock.calls.map(
          ([args]) => args.where?.id,
        ),
      ).toEqual(loan.items.map((item) => item.id));
      expect(h.db.inventoryLoanItem.updateMany.mock.calls[0][0].where).toEqual({
        id: loan.items[0].id,
        loanId: loan.id,
        organizationId: 'org',
        productId: p1,
        quantity: 2,
        deliveredQuantity: method === 'deliver' ? 0 : 2,
        returnedQuantity: 0,
        cancelledQuantity: 0,
      });
      expect(
        h.db.product.updateMany.mock.calls.map(([args]) => args.where?.id),
      ).toEqual([p1, p2]);
      expect(h.db.product.updateMany.mock.calls[0][0]).toEqual({
        where: {
          id: p1,
          organizationId: 'org',
          active: true,
          type: 'PRODUCT',
          tracksStock: true,
          version: method === 'deliver' ? 8 : 9,
          stock: {
            equals: method === 'deliver' ? 10 : 8,
            gte: method === 'deliver' ? 1 : 0,
          },
          reservedStock: {
            equals: method === 'deliver' ? 3 : 1,
            gte: method === 'deliver' ? 1 : 0,
          },
        },
        data: {
          stock: { increment: method === 'deliver' ? -1 : 1 },
          ...(method === 'deliver' ? { reservedStock: { increment: -1 } } : {}),
          version: { increment: 1 },
        },
      });
      expect(h.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      const operation = h.state().operations.at(-1)!;
      expect(operation.actorId).toBe('other');
      expect(h.state().events.slice(-2)).toMatchObject(
        input.items.map((item) => ({
          loanId: loan.id,
          organizationId: 'org',
          itemId: item.itemId,
          quantity: 1,
          createdById: 'other',
          operationId: operation.id,
          type: method === 'deliver' ? 'DELIVERED' : 'RETURNED',
        })),
      );
      expect(h.state().audits.at(-1)).toMatchObject({
        userId: 'other',
        organizationId: 'org',
        resourceId: loan.id,
        metadata: { operationId: operation.id },
      });
      expect(result).not.toHaveProperty('receiptVersion');
      expect(result).not.toHaveProperty('before');
      expect(result).not.toHaveProperty('version');
      expect(h.db.inventoryMovement.create).toHaveBeenCalledTimes(2);
      expect(h.state().movements.slice(-2)).toMatchObject(
        h
          .state()
          .events.slice(-2)
          .map((event, index) => ({
            inventoryLoanEventId: event.id,
            productId: [p1, p2][index],
            organizationId: 'org',
            userId: 'other',
            saleId: null,
            type:
              method === 'deliver'
                ? MovementType.LOAN_DELIVERY
                : MovementType.LOAN_RETURN,
            quantity: method === 'deliver' ? -1 : 1,
            previousStock: method === 'deliver' ? 10 : 8,
            newStock: 9,
            reason: expect.any(String),
          })),
      );
      expect(h.db.sale.create).not.toHaveBeenCalled();
      expect(h.db.payment.create).not.toHaveBeenCalled();
      expect(h.db.moneyLoan.create).not.toHaveBeenCalled();
    });
    it.each([
      'claim',
      'claim-throw',
      'item',
      'item-throw',
      'later-item',
      'cas',
      'product-throw',
      'later-product',
      'operation',
      'event',
      'later-event',
      'movement',
      'later-movement',
      'audit',
    ])('rolls back all stores on %s failure', async (failure) => {
      const { h, loan, input } = await prepare(true);
      const before = structuredClone(h.state());
      h.fail(failure);
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toBeDefined();
      expect(h.state()).toEqual(before);
      if (failure === 'movement' || failure === 'later-movement') {
        expect(h.db.auditLog.create).not.toHaveBeenCalled();
        expect(h.db.inventoryMovement.create).toHaveBeenCalledTimes(
          failure === 'movement' ? 1 : 2,
        );
      }
      if (failure === 'later-product')
        expect(h.calls).toEqual([
          'claim',
          'item',
          'item',
          'reserve',
          'reserve',
        ]);
      if (failure === 'later-item')
        expect(h.calls).toEqual(['claim', 'item', 'item']);
    });
    it.each([OrgRole.MEMBER, OrgRole.CASHIER, OrgRole.INVENTORY_USER])(
      'rejects role %s without transaction',
      async (role) => {
        const { h, loan, input } = await prepare();
        await expect(
          h.service[method](loan.id, input, { ...actor, role }),
        ).rejects.toMatchObject({ status: 403 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
      },
    );
    it.each(['inactive', 'tenant', 'role', 'absent'])(
      'rejects %s actual membership, including SUPER_ADMIN',
      async (kind) => {
        const { h, loan, input } = await prepare();
        if (kind === 'inactive') h.state().members[0].user = { active: false };
        if (kind === 'tenant') h.state().members[0].organizationId = 'other';
        if (kind === 'role') h.state().members[0].role = 'CASHIER';
        if (kind === 'absent') h.state().members.splice(0, 1);
        await expect(
          h.service[method](loan.id, input, { ...actor, role: 'SUPER_ADMIN' }),
        ).rejects.toMatchObject({ status: 403 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each([OrgRole.OWNER, 'SUPER_ADMIN' as const])(
      'permits %s with active administrative membership',
      async (role) => {
        const { h, loan, input } = await prepare();
        await expect(
          h.service[method](loan.id, input, { ...actor, role }),
        ).resolves.toMatchObject({ status: 'OPEN' });
      },
    );
    it('rejects missing organization and empty loan identity before transaction', async () => {
      const { h, loan, input } = await prepare();
      await expect(
        h.service[method](loan.id, input, {
          ...actor,
          organizationId: undefined,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(h.service[method](' ', input, actor)).rejects.toMatchObject({
        status: 400,
      });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it.each([
      'missing-loan',
      'foreign-loan',
      'missing-item',
      'foreign-item',
      'other-loan-item',
    ])('rejects %s with no committed effects', async (kind) => {
      const { h, loan, input } = await prepare();
      if (kind === 'foreign-loan') h.state().loans[0].organizationId = 'other';
      if (kind === 'foreign-item')
        h.state().loans[0].items[0].organizationId = 'other';
      if (kind === 'other-loan-item')
        h.state().loans[0].items[0].loanId = 'other';
      if (kind === 'missing-item') input.items[0].itemId = personId;
      const before = structuredClone(h.state());
      await expect(
        h.service[method](
          kind === 'missing-loan' ? 'missing' : loan.id,
          input,
          actor,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(h.state()).toEqual(before);
    });
    it.each(['CLOSED', 'CANCELLED'] as const)(
      'rejects fresh %s loan',
      async (status) => {
        const { h, loan, input } = await prepare();
        h.state().loans[0].status = status;
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each([undefined, -1, 1.5, 2147483647])(
      'rejects invalid/overflow loan version %s',
      async (version) => {
        const { h, loan, input } = await prepare();
        Object.assign(h.state().loans[0], { version });
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each([
      { type: 'SERVICE' },
      { tracksStock: false },
      { organizationId: 'other' },
      { active: undefined },
      { missing: true },
    ])('rejects ineligible product %j', async (patch) => {
      const { h, loan, input } = await prepare();
      if ('missing' in patch) h.state().products.splice(0, 1);
      else Object.assign(h.state().products[0], patch);
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 400 });
      expect(h.state()).toEqual(before);
    });
    it('permits inactive tracked physical return only, and never consumes reservations on return', async () => {
      const { h, loan, input } = await prepare();
      Object.assign(h.state().products[0], { active: false, reservedStock: 0 });
      if (method === 'deliver')
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 400 });
      else {
        await h.service[method](loan.id, input, actor);
        expect(h.state().products[0]).toMatchObject({
          active: false,
          reservedStock: 0,
          stock: 9,
        });
        expect(h.state().movements.at(-1)).toMatchObject({
          type: MovementType.LOAN_RETURN,
          inventoryLoanEventId: h.state().events.at(-1)!.id,
          quantity: 1,
          previousStock: 8,
          newStock: 9,
        });
      }
    });
    it.each([
      { stock: -1 },
      { reservedStock: undefined },
      { stock: 1.2 },
      { reservedStock: 11 },
      { version: undefined },
      { version: 2147483647 },
      { stock: 2147483648 },
    ])('rejects invalid product controls %j', async (patch) => {
      const { h, loan, input } = await prepare();
      Object.assign(h.state().products[0], patch);
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.state()).toEqual(before);
    });
    it('rejects reservation underflow or inactive physical product with an inconsistent reservation', async () => {
      const { h, loan, input } = await prepare();
      Object.assign(
        h.state().products[0],
        method === 'deliver'
          ? { reservedStock: 0 }
          : { active: false, reservedStock: 1 },
      );
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.state()).toEqual(before);
    });
    it('rejects insufficient reservation/stock on delivery or stock overflow on return', async () => {
      const { h, loan, input } = await prepare();
      Object.assign(
        h.state().products[0],
        method === 'deliver'
          ? { stock: 0, reservedStock: 0 }
          : { stock: 2147483647 },
      );
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.state()).toEqual(before);
    });
    it.each([
      { quantity: 0 },
      { deliveredQuantity: 3 },
      { returnedQuantity: 3 },
      { cancelledQuantity: 3 },
      { deliveredQuantity: NaN },
    ])('rejects malformed live item counts %j', async (patch) => {
      const { h, loan, input } = await prepare();
      Object.assign(h.state().loans[0].items[0], patch);
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual([]);
    });
    it('rejects quantity beyond remaining reservation/outstanding', async () => {
      const { h, loan, input } = await prepare();
      input.items[0].quantity = 3;
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual([]);
    });
    it('aggregates multiple same-product items into one product CAS (actual schema has no loan/product unique key)', async () => {
      const { h, loan, input } = await prepare(true);
      h.state().loans[0].items[1].productId = p1;
      Object.assign(h.state().products[0], {
        reservedStock: method === 'deliver' ? 5 : 1,
      });
      await h.service[method](loan.id, input, actor);
      expect(h.db.product.updateMany).toHaveBeenCalledTimes(1);
      expect(h.db.product.updateMany.mock.calls[0][0].data).toMatchObject({
        stock: { increment: method === 'deliver' ? -2 : 2 },
        version: { increment: 1 },
      });
      expect(h.state().products[0].reservedStock).toBe(
        method === 'deliver' ? 3 : 1,
      );
      const movements = h.state().movements.slice(-2);
      expect(movements).toMatchObject(
        h
          .state()
          .events.slice(-2)
          .map((event, index) => ({
            inventoryLoanEventId: event.id,
            productId: p1,
            quantity: method === 'deliver' ? -1 : 1,
            previousStock: method === 'deliver' ? 10 - index : 8 + index,
            newStock: method === 'deliver' ? 9 - index : 9 + index,
          })),
      );
      expect(
        new Set(movements.map((row) => row.inventoryLoanEventId)).size,
      ).toBe(2);
      expect(movements[1].newStock).toBe(h.state().products[0].stock);
    });
    it('rejects aggregate quantity overflow before product CAS', async () => {
      const { h, loan, input } = await prepare(true);
      for (const item of h.state().loans[0].items)
        Object.assign(item, {
          productId: p1,
          quantity: 2147483647,
          deliveredQuantity: method === 'deliver' ? 0 : 2147483647,
        });
      for (const item of input.items) item.quantity = 2147483647;
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.state()).toEqual(before);
      expect(h.db.product.updateMany).not.toHaveBeenCalled();
    });
    it('replays stored safe result after live status/counts/product/counterparty changes without writes or live lookups', async () => {
      const { h, loan, input } = await prepare(true);
      const result = await h.service[method](loan.id, input, {
        ...actor,
        userId: 'other',
      });
      h.state().loans[0].status = 'CLOSED';
      h.state().loans[0].items[0].returnedQuantity = 999;
      Object.assign(h.state().products[0], {
        active: false,
        type: 'SERVICE',
        tracksStock: false,
        stock: 0,
      });
      h.state().customers[0].active = false;
      const before = structuredClone(h.state());
      h.calls.length = 0;
      jest.clearAllMocks();
      expect(
        await h.service[method](
          loan.id,
          {
            ...input,
            requestKey: ' operation-1 ',
            items: [...input.items].reverse(),
          },
          { ...actor, userId: 'other' },
        ),
      ).toEqual(result);
      expect(h.state()).toEqual(before);
      expect(h.calls).toEqual([]);
      expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      expect(h.db.product.findFirst).not.toHaveBeenCalled();
      expect(h.db.inventoryMovement.create).not.toHaveBeenCalled();
      h.state().members[1].user = { active: false };
      await expect(
        h.service[method](loan.id, input, { ...actor, userId: 'other' }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it.each(['actor', 'type', 'loan', 'quantity', 'organization', 'key'])(
      'rejects replay mismatch %s',
      async (kind) => {
        const { h, loan, input } = await prepare();
        await h.service[method](loan.id, input, actor);
        const op = h.state().operations.at(-1)!;
        if (kind === 'type') op.type = 'CREATE';
        if (kind === 'organization') op.organizationId = 'other';
        if (kind === 'key') op.requestKey = 'other';
        const effects = [...h.calls];
        // Metadata mismatches must be parsed even if a defective store returned the row.
        if (kind === 'organization' || kind === 'key')
          h.db.inventoryLoanOperation.findUnique.mockReturnValueOnce(op);
        await expect(
          h.service[method](
            kind === 'loan' ? 'other' : loan.id,
            kind === 'quantity'
              ? { ...input, items: [{ ...input.items[0], quantity: 2 }] }
              : input,
            kind === 'actor' ? { ...actor, userId: 'other' } : actor,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual(effects);
      },
    );
    it.each(['P2002', 'P2034'])(
      'reconciles matching completed winner after %s abort outside transaction, not a simulated interleaving',
      async (code) => {
        const { h, loan, input } = await prepare();
        const result = await h.service[method](loan.id, input, actor);
        const before = structuredClone(h.state());
        h.calls.length = 0;
        h.operationLookupPhases.length = 0;
        h.db.inventoryLoanOperation.findUnique.mockReturnValueOnce(null);
        h.transactionError(
          new Prisma.PrismaClientKnownRequestError('abort', {
            code,
            clientVersion: 'test',
          }),
        );
        expect(await h.service[method](loan.id, input, actor)).toEqual(result);
        expect(h.state()).toEqual(before);
        expect(h.calls).toContain('operation');
        expect(h.operationLookupPhases).toEqual(['outside']); // hidden first lookup is explicitly mocked
        expect(h.db.$transaction).toHaveBeenCalledTimes(2);
      },
    );
    it.each(
      ['P2002', 'P2034'].flatMap((code) =>
        ['absent', 'conflicting'].map((winner) => ({ code, winner })),
      ),
    )(
      'returns 409 after abort with $winner $code winner, never retries',
      async ({ code, winner }) => {
        const { h, loan, input } = await prepare();
        if (winner === 'conflicting') {
          await h.service[method](loan.id, input, actor);
          h.state().operations.at(-1)!.actorId = 'other';
          h.db.inventoryLoanOperation.findUnique.mockReturnValueOnce(null);
        }
        const before = structuredClone(h.state());
        jest.clearAllMocks();
        h.transactionError(
          new Prisma.PrismaClientKnownRequestError('abort', {
            code,
            clientVersion: 'test',
          }),
        );
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.state()).toEqual(before);
        expect(h.db.$transaction).toHaveBeenCalledTimes(1);
      },
    );
  },
);

describe('physical serving sequence bounds', () => {
  it('handles exact Prisma Int maximum delivery/return without overflow or autoreservation', async () => {
    const h = harness();
    Object.assign(h.state().products[0], {
      stock: 2147483647,
      reservedStock: 0,
    });
    const loan = await h.service.create(
      { ...dto, items: [{ productId: p1, quantity: 2147483647 }] },
      actor,
    );
    const input = {
      requestKey: 'deliver-max',
      items: [{ itemId: loan.items[0].id, quantity: 2147483647 }],
    };
    await h.service.deliver(loan.id, input, actor);
    expect(h.state().products[0]).toMatchObject({ stock: 0, reservedStock: 0 });
    const result = await h.service.returnItems(
      loan.id,
      { ...input, requestKey: 'return-max' },
      actor,
    );
    expect(h.state().products[0]).toMatchObject({
      stock: 2147483647,
      reservedStock: 0,
    });
    expect(result).toMatchObject({
      status: 'OPEN',
      items: [{ reservedRemaining: 0, outstanding: 0 }],
    });
    await expect(
      h.service.deliver(loan.id, { ...input, requestKey: 'redeliver' }, actor),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.returnItems(
        loan.id,
        { ...input, requestKey: 'return-twice' },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('respects cancelled allocation while delivering remaining units', async () => {
    const h = harness();
    const loan = await h.service.create(dto, actor);
    h.state().loans[0].items[0].cancelledQuantity = 1;
    h.state().products[0].reservedStock = 2;
    const input = {
      requestKey: 'partial-delivery',
      items: [{ itemId: loan.items[0].id, quantity: 1 }],
    };
    const result = await h.service.deliver(loan.id, input, actor);
    expect(result.items[0]).toMatchObject({
      quantity: 2,
      cancelledQuantity: 1,
      deliveredQuantity: 1,
      reservedRemaining: 0,
    });
    await expect(
      h.service.deliver(loan.id, { ...input, requestKey: 'extra' }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('inventory operation DTO pipeline and direct guards', () => {
  const input = {
    requestKey: ' operation-1 ',
    items: [{ itemId: p1, quantity: 1 }],
  };
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  it('normalizes keys but preserves raw bounded integer quantities in the pipeline', async () => {
    expect(
      await pipe.transform(input, {
        type: 'body',
        metatype: InventoryLoanOperationDto,
      }),
    ).toEqual({ ...input, requestKey: 'operation-1' });
    expect(
      await pipe.transform(
        { ...input, items: [{ itemId: p1, quantity: 2147483647 }] },
        { type: 'body', metatype: InventoryLoanOperationDto },
      ),
    ).toMatchObject({ items: [{ quantity: 2147483647 }] });
  });
  it.each([
    { requestKey: '' },
    { requestKey: ' ' },
    { requestKey: 12 },
    { requestKey: 'x'.repeat(101) },
    { items: [] },
    { items: null },
    { items: [null] },
    { items: Array.from({ length: 101 }, () => input.items[0]) },
    { items: [{ itemId: 'bad', quantity: 1 }] },
    { items: [{ quantity: 1 }] },
    ...[0, -1, 1.1, '1', null, true, 2147483648, NaN, Infinity, undefined].map(
      (quantity) => ({ items: [{ itemId: p1, quantity }] }),
    ),
    ...['actorId', 'organizationId', 'type', 'loanId', 'notes', 'price'].map(
      (key) => ({ [key]: 'unknown' }),
    ),
    ...[
      'productId',
      'stock',
      'reservedStock',
      'version',
      'unitPrice',
      'notes',
    ].map((key) => ({ items: [{ ...input.items[0], [key]: 1 }] })),
  ])(
    'rejects malformed/unknown input %j through nested whitelist pipeline and both direct methods',
    async (patch) => {
      const raw = { ...input, ...patch };
      await expect(
        pipe.transform(raw, {
          type: 'body',
          metatype: InventoryLoanOperationDto,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const h = harness();
      for (const method of ['deliver', 'returnItems'] as const)
        await expect(
          h.service[method]('loan', raw as InventoryLoanOperationDto, actor),
        ).rejects.toMatchObject({ status: 400 });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects duplicate selected IDs and null raw bodies directly before any effects', async () => {
    const h = harness();
    for (const method of ['deliver', 'returnItems'] as const) {
      await expect(
        h.service[method](
          'loan',
          { ...input, items: [...input.items, ...input.items] },
          actor,
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        h.service[method](
          'loan',
          null as unknown as InventoryLoanOperationDto,
          actor,
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
});

describe.each(['deliver', 'returnItems'] as const)(
  '%s operation-specific receipt validation',
  (method) => {
    type Projection = Row & { items: Row[] };
    type Receipt = Row & { before: Projection; after: Projection };
    async function completed(counterpartyType = CounterpartyType.CUSTOMER) {
      const h = harness();
      const loan = await h.service.create(
        {
          ...dto,
          counterpartyType,
          items: [...dto.items, { productId: p2, quantity: 2 }],
        },
        actor,
      );
      if (method === 'returnItems')
        await h.service.deliver(
          loan.id,
          {
            requestKey: 'setup-delivery',
            items: loan.items.map((item) => ({ itemId: item.id, quantity: 2 })),
          },
          actor,
        );
      const input = {
        requestKey: 'selected-1',
        items: [{ itemId: loan.items[0].id, quantity: 1 }],
      };
      const result = await h.service[method](loan.id, input, {
        ...actor,
        userId: 'other',
      });
      const operation = h.state().operations.at(-1)!;
      return {
        h,
        loan,
        input,
        result,
        operation,
        receipt: operation.resultSnapshot as unknown as Receipt,
      };
    }
    function recalculate(item: Row) {
      item.reservedRemaining =
        (item.quantity as number) -
        (item.deliveredQuantity as number) -
        (item.cancelledQuantity as number);
      item.outstanding =
        (item.deliveredQuantity as number) - (item.returnedQuantity as number);
    }
    it.each([
      'receipt-version',
      'receipt-type',
      'receipt-actor',
      'receipt-extra',
      'after-extra',
      'before-extra',
      'loan-mismatch',
      'organization-mismatch',
      'creator-empty',
      'timestamp',
      'terminal-snapshot',
      'metadata-divergence',
      'duplicate-item',
      'empty-item',
      'extra-item',
      'symmetric-selected-ID',
      'selected-delta',
      'before-delta',
      'untouched-delta',
      'quantity-bound',
      'derived-counter',
      'request-quantity',
      'product-identity',
    ])(
      'rejects otherwise valid receipt corruption: %s without live fallback or effects',
      async (kind) => {
        const { h, loan, input, receipt, operation } = await completed();
        if (kind === 'receipt-version') receipt.receiptVersion = 2;
        if (kind === 'receipt-type')
          receipt.type = method === 'deliver' ? 'RETURN' : 'DELIVER';
        if (kind === 'receipt-actor') receipt.actorId = 'actor';
        if (kind === 'receipt-extra') receipt.private = 'never-public';
        if (kind === 'after-extra') receipt.after.private = 'never-public';
        if (kind === 'before-extra') receipt.before.private = 'never-public';
        if (kind === 'loan-mismatch')
          receipt.before.id = receipt.after.id = 'wrong';
        if (kind === 'organization-mismatch')
          receipt.before.organizationId = receipt.after.organizationId =
            'wrong';
        if (kind === 'creator-empty')
          receipt.before.createdById = receipt.after.createdById = ' ';
        if (kind === 'timestamp')
          receipt.before.createdAt = receipt.after.createdAt = 'bad';
        if (kind === 'terminal-snapshot')
          receipt.before.status = receipt.after.status = 'CLOSED';
        if (kind === 'metadata-divergence')
          receipt.after.createdById = 'new-valid-creator';
        if (kind === 'duplicate-item')
          receipt.after.items[1] = { ...receipt.after.items[0] };
        if (kind === 'empty-item')
          receipt.before.items = receipt.after.items = [];
        if (kind === 'extra-item') {
          for (const projection of [receipt.before, receipt.after])
            projection.items.push({ ...projection.items[1], id: 'zz-extra' });
        }
        if (kind === 'symmetric-selected-ID') {
          receipt.before.items[0].id = receipt.after.items[0].id =
            '00000000-0000-4000-8000-000000000099';
          receipt.itemIds = receipt.before.items.map((item) => item.id);
        }
        if (kind === 'selected-delta') {
          receipt.after.items[0][
            method === 'deliver' ? 'deliveredQuantity' : 'returnedQuantity'
          ] = 2;
          recalculate(receipt.after.items[0]);
        }
        if (kind === 'before-delta') {
          receipt.before.items[0][
            method === 'deliver' ? 'deliveredQuantity' : 'returnedQuantity'
          ] = 1;
          recalculate(receipt.before.items[0]);
        }
        if (kind === 'untouched-delta') {
          receipt.after.items[1][
            method === 'deliver' ? 'deliveredQuantity' : 'returnedQuantity'
          ] = 1;
          recalculate(receipt.after.items[1]);
        }
        if (kind === 'quantity-bound')
          receipt.after.items[0].quantity = 2147483648;
        if (kind === 'derived-counter')
          receipt.after.items[0].outstanding = 999;
        if (kind === 'request-quantity') {
          // Request and stored payload still match exactly; only receipt delta disagrees.
          input.items[0].quantity = 2;
          (
            operation.requestPayload as unknown as {
              items: Array<{ quantity: number }>;
            }
          ).items[0].quantity = 2;
        }
        if (kind === 'product-identity')
          receipt.after.items[0].productId = personId;
        const before = structuredClone(h.state());
        h.calls.length = 0;
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, userId: 'other' }),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.state()).toEqual(before);
        expect(h.calls).toEqual([]);
        expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      },
    );
    it.each(
      (
        [
          [CounterpartyType.CUSTOMER, 'customerId'],
          [CounterpartyType.SUPPLIER, 'supplierId'],
          [CounterpartyType.EMPLOYEE, 'employeeId'],
        ] as const
      ).flatMap(([counterpartyType, selected]) =>
        (['customerId', 'supplierId', 'employeeId'] as const).flatMap((field) =>
          (field === selected
            ? ['', ' ', null, 7, undefined]
            : ['', ' ', personId, 7, undefined]
          ).map((value) => ({ counterpartyType, field, value })),
        ),
      ),
    )(
      'rejects symmetric otherwise-valid counterparty corruption %j',
      async ({ counterpartyType, field, value }) => {
        const { h, loan, input, receipt } = await completed(counterpartyType);
        receipt.before[field] = receipt.after[field] = value;
        h.calls.length = 0;
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, userId: 'other' }),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
        expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      },
    );
    it.each(Object.values(CounterpartyType))(
      'replays valid %s with lifecycle actor distinct from original creator',
      async (counterpartyType) => {
        const { h, loan, input, result } = await completed(counterpartyType);
        expect(
          await h.service[method](loan.id, input, {
            ...actor,
            userId: 'other',
          }),
        ).toEqual(result);
        expect(result.createdById).toBe('actor');
        expect(result).not.toHaveProperty('requestPayload');
        expect(result).not.toHaveProperty('before');
      },
    );
  },
);

describe('internal terminal behavior — initial test-first cases', () => {
  it('cancels a never-delivered loan and releases only reservations', async () => {
    const h = harness();
    const loan = await h.service.create(dto, actor);
    await expect(
      h.service.cancel(loan.id, { requestKey: 'cancel-1' }, actor),
    ).resolves.toMatchObject({
      status: 'CANCELLED',
      items: [
        {
          quantity: 2,
          deliveredQuantity: 0,
          returnedQuantity: 0,
          cancelledQuantity: 2,
          reservedRemaining: 0,
          outstanding: 0,
        },
      ],
    });
    expect(h.state().products[0]).toMatchObject({
      stock: 10,
      reservedStock: 1,
    });
    expect(h.state().loans[0].status).toBe('CANCELLED');
  });
  it('closes a partial fully-returned delivery and releases the undelivered remainder', async () => {
    const h = harness();
    const loan = await h.service.create(dto, actor);
    const servicing = {
      requestKey: 'deliver-1',
      items: [{ itemId: loan.items[0].id, quantity: 1 }],
    };
    await h.service.deliver(loan.id, servicing, actor);
    await h.service.returnItems(
      loan.id,
      { ...servicing, requestKey: 'return-1' },
      actor,
    );
    expect(h.state().loans[0].status).toBe('OPEN');
    await expect(
      h.service.close(loan.id, { requestKey: 'close-1' }, actor),
    ).resolves.toMatchObject({
      status: 'CLOSED',
      items: [
        {
          quantity: 2,
          deliveredQuantity: 1,
          returnedQuantity: 1,
          cancelledQuantity: 1,
          reservedRemaining: 0,
          outstanding: 0,
        },
      ],
    });
    expect(h.state().products[0]).toMatchObject({
      stock: 10,
      reservedStock: 1,
    });
    expect(h.state().loans[0].status).toBe('CLOSED');
  });
});

type TerminalMethod = 'cancel' | 'close';
async function prepareTerminal(
  method: TerminalMethod,
  counterpartyType = CounterpartyType.CUSTOMER,
) {
  const h = harness();
  const loan = await h.service.create(
    {
      ...dto,
      counterpartyType,
      items: [...dto.items, { productId: p2, quantity: 2 }],
    },
    actor,
  );
  if (method === 'close') {
    const input = {
      requestKey: 'setup-delivery',
      items: [{ itemId: loan.items[0].id, quantity: 1 }],
    };
    await h.service.deliver(loan.id, input, actor);
    await h.service.returnItems(
      loan.id,
      { ...input, requestKey: 'setup-return' },
      actor,
    );
  }
  h.calls.length = 0;
  h.operationLookupPhases.length = 0;
  jest.clearAllMocks();
  return { h, loan, input: { requestKey: 'terminal-1' } };
}

describe('terminal policy exclusions', () => {
  it.each([0, 1, 2])(
    'CANCEL rejects any historical delivery, even with %s returned units',
    async (returnedQuantity) => {
      const { h, loan, input } = await prepareTerminal('cancel');
      Object.assign(h.state().loans[0].items[0], {
        deliveredQuantity: 2,
        returnedQuantity,
      });
      await expect(
        h.service.cancel(loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual([]);
    },
  );
  it.each([false, true])(
    'CLOSE rejects never-delivered loans, fully released=%s',
    async (released) => {
      const { h, loan, input } = await prepareTerminal('cancel');
      if (released)
        for (const item of h.state().loans[0].items) item.cancelledQuantity = 2;
      await expect(
        h.service.close(loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual([]);
    },
  );
  it('CLOSE rejects outstanding delivery on any item, including an otherwise untouched item', async () => {
    const { h, loan, input } = await prepareTerminal('close');
    h.state().loans[0].items[1].deliveredQuantity = 1;
    await expect(h.service.close(loan.id, input, actor)).rejects.toMatchObject({
      status: 409,
    });
    expect(h.calls).toEqual([]);
  });
});

describe.each(['cancel', 'close'] as const)(
  'internal %s terminal contract',
  (method) => {
    const status = method === 'cancel' ? 'CANCELLED' : 'CLOSED';
    it('claims once, pins every item and releases sorted reservations without stock writes; operation precedes all evidence', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      const prior = structuredClone(h.state());
      const result = await h.service[method](loan.id, input, {
        ...actor,
        userId: 'other',
      });
      expect(result.createdById).toBe('actor');
      expect(result.status).toBe(status);
      expect(result.items.map((item) => item.reservedRemaining)).toEqual([
        0, 0,
      ]);
      expect(h.calls).toEqual([
        'claim',
        'item',
        'item',
        'reserve',
        'reserve',
        'operation',
        'event',
        'event',
        'event',
        'audit',
      ]);
      expect(h.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(h.db.inventoryLoan.updateMany).toHaveBeenCalledTimes(1);
      expect(h.db.inventoryLoan.updateMany).toHaveBeenCalledWith({
        where: {
          id: loan.id,
          organizationId: 'org',
          status: 'OPEN',
          version: prior.loans[0].version,
        },
        data: { status, version: { increment: 1 } },
      });
      for (let index = 0; index < 2; index++) {
        const old = prior.loans[0].items[index];
        expect(h.db.inventoryLoanItem.updateMany.mock.calls[index][0]).toEqual({
          where: {
            id: old.id,
            loanId: loan.id,
            organizationId: 'org',
            productId: old.productId,
            quantity: old.quantity,
            deliveredQuantity: old.deliveredQuantity,
            returnedQuantity: old.returnedQuantity,
            cancelledQuantity: old.cancelledQuantity,
          },
          data: {
            cancelledQuantity: {
              increment:
                old.quantity - old.deliveredQuantity - old.cancelledQuantity,
            },
          },
        });
        expect(h.state().loans[0].items[index]).toMatchObject({
          quantity: old.quantity,
          deliveredQuantity: old.deliveredQuantity,
          returnedQuantity: old.returnedQuantity,
        });
        const product = prior.products[index];
        const release =
          old.quantity - old.deliveredQuantity - old.cancelledQuantity;
        expect(h.db.product.updateMany.mock.calls[index][0]).toEqual({
          where: {
            id: product.id,
            organizationId: 'org',
            active: true,
            type: 'PRODUCT',
            tracksStock: true,
            version: product.version,
            stock: { equals: product.stock, gte: product.reservedStock },
            reservedStock: { equals: product.reservedStock, gte: release },
          },
          data: {
            reservedStock: { increment: -release },
            version: { increment: 1 },
          },
        });
        expect(h.state().products[index].stock).toBe(product.stock);
      }
      expect(
        h.db.product.updateMany.mock.calls.map(([args]) => args.where?.id),
      ).toEqual([p1, p2]);
      const op = h.state().operations.at(-1)!;
      expect(op.requestPayload).toEqual({
        type: method === 'cancel' ? 'CANCEL' : 'CLOSE',
        loanId: loan.id,
      });
      expect(h.state().events.slice(-3)).toMatchObject([
        {
          itemId: loan.items[0].id,
          quantity: method === 'cancel' ? 2 : 1,
          type: 'CANCELLED',
          operationId: op.id,
          createdById: 'other',
          loanId: loan.id,
          organizationId: 'org',
        },
        {
          itemId: loan.items[1].id,
          quantity: 2,
          type: 'CANCELLED',
          operationId: op.id,
          createdById: 'other',
        },
        {
          itemId: null,
          quantity: null,
          type: status,
          operationId: op.id,
          createdById: 'other',
        },
      ]);
      expect(h.state().audits.at(-1)).toMatchObject({
        action:
          method === 'cancel'
            ? 'INVENTORY_LOAN_CANCELLED'
            : 'INVENTORY_LOAN_CLOSED',
        userId: 'other',
        organizationId: 'org',
        resource: 'InventoryLoan',
        resourceId: loan.id,
        metadata: { operationId: op.id },
      });
      for (const key of [
        'receiptVersion',
        'before',
        'releases',
        'requestPayload',
        'version',
      ])
        expect(result).not.toHaveProperty(key);
      for (const write of [
        h.db.inventoryMovement.create,
        h.db.sale.create,
        h.db.payment.create,
        h.db.moneyLoan.create,
      ])
        expect(write).not.toHaveBeenCalled();
    });
    it.each([
      'claim',
      'claim-throw',
      'item',
      'item-throw',
      'later-item',
      'cas',
      'product-throw',
      'later-product',
      'operation',
      'event',
      'later-event',
      'header-event',
      'audit',
    ])('rolls back every staged store on %s failure', async (failure) => {
      const { h, loan, input } = await prepareTerminal(method);
      const before = structuredClone(h.state());
      h.fail(failure);
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toBeDefined();
      expect(h.state()).toEqual(before);
      if (failure === 'header-event')
        expect(h.calls.slice(-4)).toEqual([
          'operation',
          'event',
          'event',
          'event',
        ]);
      if (failure === 'later-product')
        expect(h.calls).toEqual([
          'claim',
          'item',
          'item',
          'reserve',
          'reserve',
        ]);
    });
    it('pins zero-release items, makes no product lookup/write for them, and records exactly one header with no release events', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      for (const item of h.state().loans[0].items)
        item.cancelledQuantity = item.quantity - item.deliveredQuantity;
      for (const product of h.state().products)
        Object.assign(product, { type: 'SERVICE', stock: 0, reservedStock: 0 });
      const products = structuredClone(h.state().products);
      await h.service[method](loan.id, input, actor);
      expect(h.db.inventoryLoanItem.updateMany).toHaveBeenCalledTimes(2);
      expect(
        h.db.inventoryLoanItem.updateMany.mock.calls.every(
          ([args]) =>
            (args.data.cancelledQuantity as { increment: number }).increment ===
            0,
        ),
      ).toBe(true);
      expect(h.db.product.findFirst).not.toHaveBeenCalled();
      expect(h.db.product.updateMany).not.toHaveBeenCalled();
      expect(h.state().products).toEqual(products);
      expect(h.db.inventoryLoanEvent.create).toHaveBeenCalledTimes(1);
      expect(h.state().events.at(-1)).toMatchObject({
        type: status,
        itemId: null,
        quantity: null,
      });
    });
    it('rolls back when the CAS on a zero-release item loses', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      h.state().loans[0].items[1].cancelledQuantity = 2;
      const before = structuredClone(h.state());
      h.fail('later-item');
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.state()).toEqual(before);
      expect(h.db.product.updateMany).not.toHaveBeenCalled();
    });
    it.each([false, true])(
      'aggregates two same-product items into one CAS; loss=%s rolls back',
      async (lose) => {
        const { h, loan, input } = await prepareTerminal(method);
        h.state().loans[0].items[1].productId = p1;
        h.state().products[0].reservedStock = method === 'cancel' ? 5 : 4;
        const before = structuredClone(h.state());
        if (lose) h.fail('cas');
        if (lose) {
          await expect(
            h.service[method](loan.id, input, actor),
          ).rejects.toMatchObject({ status: 409 });
          expect(h.state()).toEqual(before);
        } else {
          const result = await h.service[method](loan.id, input, actor);
          expect(result.items.map((item) => item.productId)).toEqual([p1, p1]);
          expect(h.state().products[0].reservedStock).toBe(1);
          expect(await h.service[method](loan.id, input, actor)).toEqual(
            result,
          );
        }
        expect(h.db.product.updateMany).toHaveBeenCalledTimes(1);
        expect(h.db.product.updateMany.mock.calls[0][0].data).toEqual({
          reservedStock: { increment: method === 'cancel' ? -4 : -3 },
          version: { increment: 1 },
        });
      },
    );
    it('rejects same-product aggregate overflow before product writes', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      for (const item of h.state().loans[0].items)
        Object.assign(item, { productId: p1, quantity: 2147483647 });
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.state()).toEqual(before);
      expect(h.db.product.updateMany).not.toHaveBeenCalled();
    });
    it('accepts bounded maximum release without changing stock or previous cancellations', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      const item = h.state().loans[0].items[1];
      Object.assign(item, { quantity: 2147483647, cancelledQuantity: 1 });
      Object.assign(h.state().products[1], {
        stock: 2147483647,
        reservedStock: 2147483646,
      });
      const result = await h.service[method](loan.id, input, actor);
      expect(result.items[1]).toMatchObject({
        quantity: 2147483647,
        cancelledQuantity: 2147483647,
        deliveredQuantity: 0,
        returnedQuantity: 0,
      });
      expect(h.state().products[1]).toMatchObject({
        stock: 2147483647,
        reservedStock: 0,
      });
    });
    it.each([OrgRole.MEMBER, OrgRole.CASHIER, OrgRole.INVENTORY_USER])(
      'rejects %s before transaction',
      async (role) => {
        const { h, loan, input } = await prepareTerminal(method);
        await expect(
          h.service[method](loan.id, input, { ...actor, role }),
        ).rejects.toMatchObject({ status: 403 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
      },
    );
    it.each(['inactive', 'tenant', 'role', 'absent'])(
      'requires actual active ADMIN/OWNER membership before replay: %s',
      async (kind) => {
        const { h, loan, input } = await prepareTerminal(method);
        await h.service[method](loan.id, input, actor);
        if (kind === 'inactive') h.state().members[0].user = { active: false };
        if (kind === 'tenant') h.state().members[0].organizationId = 'other';
        if (kind === 'role') h.state().members[0].role = 'CASHIER';
        if (kind === 'absent') h.state().members.splice(0, 1);
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, role: 'SUPER_ADMIN' }),
        ).rejects.toMatchObject({ status: 403 });
        expect(h.db.inventoryLoanOperation.findUnique).not.toHaveBeenCalled();
      },
    );
    it.each([OrgRole.OWNER, 'SUPER_ADMIN' as const])(
      'permits %s only with administrative membership',
      async (role) => {
        const { h, loan, input } = await prepareTerminal(method);
        h.state().members[0].role = 'OWNER';
        await expect(
          h.service[method](loan.id, input, { ...actor, role }),
        ).resolves.toMatchObject({ status });
      },
    );
    it.each(['missing', 'foreign'])(
      'returns scoped 404 for %s loan',
      async (kind) => {
        const { h, loan, input } = await prepareTerminal(method);
        if (kind === 'foreign') h.state().loans[0].organizationId = 'other';
        await expect(
          h.service[method](
            kind === 'missing' ? 'missing' : loan.id,
            input,
            actor,
          ),
        ).rejects.toMatchObject({ status: 404 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each(['organizationId', 'loanId'])(
      'rejects a foreign %s on any live item rather than silently omitting it',
      async (field) => {
        const { h, loan, input } = await prepareTerminal(method);
        Object.assign(h.state().loans[0].items[1], { [field]: 'other' });
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each(['CANCELLED', 'CLOSED'] as const)(
      'rejects fresh %s and cannot reopen',
      async (priorStatus) => {
        const { h, loan, input } = await prepareTerminal(method);
        h.state().loans[0].status = priorStatus;
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each([undefined, -1, 1.5, '1', 2147483647])(
      'rejects invalid/overflow header version %s',
      async (version) => {
        const { h, loan, input } = await prepareTerminal(method);
        Object.assign(h.state().loans[0], { version });
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each([
      { quantity: 0 },
      { quantity: 2147483648 },
      { quantity: '2' },
      { deliveredQuantity: NaN },
      { returnedQuantity: 3 },
      { cancelledQuantity: 3 },
      { quantity: 1.1 },
    ])('rejects invalid counts on all items %j', async (patch) => {
      const { h, loan, input } = await prepareTerminal(method);
      Object.assign(h.state().loans[0].items[1], patch);
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual([]);
    });
    it('rejects empty live item set', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      h.state().loans[0].items = [];
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.calls).toEqual([]);
    });
    it.each([
      { active: false },
      { type: 'SERVICE' },
      { tracksStock: false },
      { organizationId: 'other' },
      { active: undefined },
    ])('rejects ineligible positive-release product %j', async (patch) => {
      const { h, loan, input } = await prepareTerminal(method);
      Object.assign(h.state().products[1], patch);
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 400 });
      expect(h.state()).toEqual(before);
    });
    it.each([
      { stock: -1 },
      { reservedStock: 0 },
      { reservedStock: undefined },
      { reservedStock: 11 },
      { stock: 1.1 },
      { version: 2147483647 },
      { version: undefined },
      { version: -1 },
      { stock: 2147483648 },
    ])(
      'rejects insufficient/invalid positive-release product controls %j',
      async (patch) => {
        const { h, loan, input } = await prepareTerminal(method);
        Object.assign(h.state().products[1], patch);
        const before = structuredClone(h.state());
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.state()).toEqual(before);
      },
    );
    it('rejects missing positive-release product and rolls back earlier release', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      h.state().products.splice(1, 1);
      const before = structuredClone(h.state());
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 400 });
      expect(h.state()).toEqual(before);
    });
    it('replays immutable safe result despite later live names/counts/status/stock changes, with no live fallback or mutation', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      const result = await h.service[method](loan.id, input, {
        ...actor,
        userId: 'other',
      });
      Object.assign(h.state().loans[0], {
        status: 'OPEN',
        customerId: 'changed-live',
      });
      h.state().loans[0].items[0].returnedQuantity = 999;
      Object.assign(h.state().products[0], {
        stock: 0,
        reservedStock: 999,
        type: 'SERVICE',
      });
      h.state().customers[0].name = 'changed-live-name';
      const before = structuredClone(h.state());
      h.calls.length = 0;
      jest.clearAllMocks();
      expect(
        await h.service[method](
          loan.id,
          { requestKey: ' terminal-1 ' },
          { ...actor, userId: 'other' },
        ),
      ).toEqual(result);
      expect(h.state()).toEqual(before);
      expect(h.calls).toEqual([]);
      expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      expect(h.db.product.findFirst).not.toHaveBeenCalled();
      expect(h.db.customer.findFirst).not.toHaveBeenCalled();
    });
    it.each(['actor', 'loan', 'organization', 'key', 'payload', 'type'])(
      'rejects operation identity/payload mismatch %s without effects',
      async (kind) => {
        const { h, loan, input } = await prepareTerminal(method);
        await h.service[method](loan.id, input, actor);
        const op = h.state().operations.at(-1)!;
        if (kind === 'organization') op.organizationId = 'other';
        if (kind === 'key') op.requestKey = 'other';
        if (kind === 'type') op.type = method === 'cancel' ? 'CLOSE' : 'CANCEL';
        if (kind === 'payload')
          op.requestPayload = {
            ...(op.requestPayload as Prisma.JsonObject),
            private: true,
          };
        if (kind === 'organization' || kind === 'key')
          h.db.inventoryLoanOperation.findUnique.mockReturnValueOnce(op);
        h.calls.length = 0;
        await expect(
          h.service[method](
            kind === 'loan' ? 'other' : loan.id,
            input,
            kind === 'actor' ? { ...actor, userId: 'other' } : actor,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each(['CREATE', 'DELIVER', 'RETURN', 'CANCEL', 'CLOSE'] as const)(
      'shares the tenant-wide key with %s and rejects cross-operation reuse',
      async (otherType) => {
        const { h, loan } = await prepareTerminal(method);
        const op = h.state().operations[0];
        op.type = otherType;
        await expect(
          h.service[method](loan.id, { requestKey: dto.requestKey }, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
      },
    );
    it.each(['P2002', 'P2034'])(
      'reconciles completed matching %s winner only outside aborted transaction',
      async (code) => {
        const { h, loan, input } = await prepareTerminal(method);
        const result = await h.service[method](loan.id, input, actor);
        const winner = structuredClone(h.state().operations.at(-1)!);
        // Explicit mock winner, not a PostgreSQL interleaving. Live state is eligible for the aborted attempt.
        h.state().loans[0].status = 'OPEN';
        for (const item of h.state().loans[0].items) item.cancelledQuantity = 0;
        for (const product of h.state().products) product.reservedStock = 5;
        const before = structuredClone(h.state());
        h.db.inventoryLoanOperation.findUnique
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(winner);
        jest.clearAllMocks();
        h.transactionError(
          new Prisma.PrismaClientKnownRequestError('abort', {
            code,
            clientVersion: 'test',
          }),
        );
        expect(await h.service[method](loan.id, input, actor)).toEqual(result);
        expect(h.state()).toEqual(before);
        expect(h.db.$transaction).toHaveBeenCalledTimes(1);
        expect(h.db.organizationUser.findFirst).toHaveBeenCalledTimes(2);
        expect(h.db.inventoryLoanOperation.findUnique).toHaveBeenCalledTimes(2);
      },
    );
    it.each(
      ['P2002', 'P2034'].flatMap((code) =>
        ['absent', 'actor', 'type', 'payload'].map((winner) => ({
          code,
          winner,
        })),
      ),
    )(
      'returns 409 for $winner winner after $code, without blind retry',
      async ({ code, winner }) => {
        const { h, loan, input } = await prepareTerminal(method);
        const op = {
          ...structuredClone(h.state().operations[0]),
          requestKey: input.requestKey,
          type: method === 'cancel' ? 'CANCEL' : 'CLOSE',
          requestPayload: {
            type: method === 'cancel' ? 'CANCEL' : 'CLOSE',
            loanId: loan.id,
          },
        } as InventoryLoanOperation;
        if (winner === 'actor') op.actorId = 'other';
        if (winner === 'type') op.type = 'CREATE';
        if (winner === 'payload')
          op.requestPayload = { type: 'other', loanId: loan.id };
        h.db.inventoryLoanOperation.findUnique
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(winner === 'absent' ? null : op);
        const before = structuredClone(h.state());
        h.transactionError(
          new Prisma.PrismaClientKnownRequestError('abort', {
            code,
            clientVersion: 'test',
          }),
        );
        await expect(
          h.service[method](loan.id, input, actor),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.state()).toEqual(before);
        expect(h.db.$transaction).toHaveBeenCalledTimes(1);
      },
    );
    it('rechecks authorization before outside-abort evidence and propagates a membership refusal', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      h.db.organizationUser.findFirst
        .mockReturnValueOnce(h.state().members[0])
        .mockReturnValueOnce(null);
      h.transactionError(
        new Prisma.PrismaClientKnownRequestError('abort', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );
      await expect(
        h.service[method](loan.id, input, actor),
      ).rejects.toMatchObject({ status: 403 });
      expect(h.operationLookupPhases).toEqual(['inside']);
      expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    });
    it('uses a distinct tenant key namespace without replaying another tenant’s terminal evidence', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      await h.service[method](loan.id, input, actor);
      const original = structuredClone(h.state().loans[0]);
      h.state().members.push({
        ...h.state().members[0],
        organizationId: 'org-2',
      });
      h.state().customers.push({
        ...h.state().customers[0],
        organizationId: 'org-2',
      });
      h.state().products.push({
        ...h.state().products[0],
        organizationId: 'org-2',
        reservedStock: 0,
      });
      const secondActor = { ...actor, organizationId: 'org-2' };
      const second = await h.service.create(
        { ...dto, requestKey: 'second-create' },
        secondActor,
      );
      if (method === 'close') {
        const serving = {
          requestKey: 'second-deliver',
          items: [{ itemId: second.items[0].id, quantity: 1 }],
        };
        await h.service.deliver(second.id, serving, secondActor);
        await h.service.returnItems(
          second.id,
          { ...serving, requestKey: 'second-return' },
          secondActor,
        );
      }
      const result = await h.service[method](second.id, input, secondActor);
      expect(result.organizationId).toBe('org-2');
      expect(result.id).toBe(second.id);
      expect(h.state().loans[0]).toEqual(original);
      expect(
        h
          .state()
          .operations.filter(
            (operation) => operation.requestKey === input.requestKey,
          ),
      ).toHaveLength(2);
      expect(h.db.inventoryLoanOperation.findUnique).toHaveBeenLastCalledWith({
        where: {
          organizationId_requestKey: {
            organizationId: 'org-2',
            requestKey: input.requestKey,
          },
        },
      });
    });
    it('does not reconcile unrelated transaction errors', async () => {
      const { h, loan, input } = await prepareTerminal(method);
      const error = new Prisma.PrismaClientKnownRequestError('abort', {
        code: 'P2025',
        clientVersion: 'test',
      });
      h.transactionError(error);
      await expect(h.service[method](loan.id, input, actor)).rejects.toBe(
        error,
      );
      expect(h.operationLookupPhases).toEqual(['inside']);
    });
  },
);

describe('strict terminal DTO and direct boundary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  it('accepts only normalized raw requestKey and no mandatory reason', async () => {
    expect(
      await pipe.transform(
        { requestKey: ' terminal ' },
        { type: 'body', metatype: InventoryLoanTerminalDto },
      ),
    ).toEqual({ requestKey: 'terminal' });
  });
  it.each([
    { requestKey: '' },
    { requestKey: ' ' },
    { requestKey: 1 },
    { requestKey: true },
    { requestKey: null },
    { requestKey: undefined },
    { requestKey: 'x'.repeat(101) },
    ...[
      'items',
      'reason',
      'actorId',
      'organizationId',
      'loanId',
      'type',
      'stock',
      'quantity',
      'price',
    ].map((field) => ({ requestKey: 'valid', [field]: 'forbidden' })),
  ])(
    'rejects malformed/unknown %j in pipeline and direct methods',
    async (raw) => {
      await expect(
        pipe.transform(raw, {
          type: 'body',
          metatype: InventoryLoanTerminalDto,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const h = harness();
      for (const method of ['cancel', 'close'] as const)
        await expect(
          h.service[method]('loan', raw as InventoryLoanTerminalDto, actor),
        ).rejects.toMatchObject({ status: 400 });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([null, undefined, [], 1, true, 'key'])(
    'rejects raw body %j directly',
    async (raw) => {
      const h = harness();
      for (const method of ['cancel', 'close'] as const)
        await expect(
          h.service[method](
            'loan',
            raw as unknown as InventoryLoanTerminalDto,
            actor,
          ),
        ).rejects.toMatchObject({ status: 400 });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, null, 1, true, '', ' '])(
    'rejects raw loan identity %s directly',
    async (id) => {
      const h = harness();
      for (const method of ['cancel', 'close'] as const)
        await expect(
          h.service[method](id as string, { requestKey: 'valid' }, actor),
        ).rejects.toMatchObject({ status: 400 });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects absent organization and blank actor identity before transaction', async () => {
    const h = harness();
    for (const method of ['cancel', 'close'] as const) {
      await expect(
        h.service[method](
          'loan',
          { requestKey: 'valid' },
          { ...actor, organizationId: undefined },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        h.service[method](
          'loan',
          { requestKey: 'valid' },
          { ...actor, userId: ' ' },
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
});

describe.each(['cancel', 'close'] as const)(
  '%s strict terminal receipt',
  (method) => {
    type Projection = Row & { items: Row[] };
    type Receipt = Row & {
      before: Projection;
      after: Projection;
      releases: Row[];
    };
    async function completed(counterpartyType = CounterpartyType.CUSTOMER) {
      const setup = await prepareTerminal(method, counterpartyType);
      const result = await setup.h.service[method](setup.loan.id, setup.input, {
        ...actor,
        userId: 'other',
      });
      return {
        ...setup,
        result,
        receipt: setup.h.state().operations.at(-1)!
          .resultSnapshot as unknown as Receipt,
      };
    }
    function recalculate(item: Row) {
      item.reservedRemaining =
        (item.quantity as number) -
        (item.deliveredQuantity as number) -
        (item.cancelledQuantity as number);
      item.outstanding =
        (item.deliveredQuantity as number) - (item.returnedQuantity as number);
    }
    it.each([
      'version',
      'type',
      'actor',
      'private-receipt',
      'private-before',
      'private-after',
      'private-item',
      'loan',
      'tenant',
      'creator',
      'timestamp',
      'before-status',
      'after-status',
      'header-change',
      'duplicate-ID',
      'empty-items',
      'too-many-items',
      'blank-ID',
      'blank-product',
      'product-change',
      'untouched-ID-change',
      'wrong-terminal-status',
      'item-order',
      'allocation-change',
      'delivery-change',
      'return-change',
      'release-delta',
      'derived',
      'itemIds',
      'releases',
      'release-private',
      'no-delivery-close-or-delivered-cancel',
    ])(
      'rejects otherwise valid corruption %s without fallback or effects',
      async (kind) => {
        const { h, loan, input, receipt } = await completed();
        if (kind === 'version') receipt.receiptVersion = 2;
        if (kind === 'type')
          receipt.type = method === 'cancel' ? 'CLOSE' : 'CANCEL';
        if (kind === 'actor') receipt.actorId = 'actor';
        if (kind === 'private-receipt') receipt.private = 'never-public';
        if (kind === 'private-before') receipt.before.private = 'never-public';
        if (kind === 'private-after') receipt.after.private = 'never-public';
        if (kind === 'private-item')
          receipt.after.items[0].private = 'never-public';
        if (kind === 'loan') receipt.before.id = receipt.after.id = 'wrong';
        if (kind === 'tenant')
          receipt.before.organizationId = receipt.after.organizationId =
            'wrong';
        if (kind === 'creator')
          receipt.before.createdById = receipt.after.createdById = ' ';
        if (kind === 'timestamp')
          receipt.before.createdAt = receipt.after.createdAt = 'bad';
        if (kind === 'before-status') receipt.before.status = 'CANCELLED';
        if (kind === 'after-status') receipt.after.status = 'OPEN';
        if (kind === 'header-change') receipt.after.createdById = 'valid-other';
        if (kind === 'duplicate-ID')
          receipt.after.items[1] = { ...receipt.after.items[0] };
        if (kind === 'empty-items')
          receipt.before.items = receipt.after.items = [];
        if (kind === 'too-many-items')
          receipt.before.items = receipt.after.items = Array.from(
            { length: 101 },
            (_, index) => ({ ...receipt.before.items[0], id: `item-${index}` }),
          );
        if (kind === 'blank-ID')
          receipt.before.items[1].id = receipt.after.items[1].id = ' ';
        if (kind === 'blank-product')
          receipt.before.items[1].productId = receipt.after.items[1].productId =
            ' ';
        if (kind === 'product-change')
          receipt.after.items[1].productId = personId;
        if (kind === 'untouched-ID-change')
          receipt.after.items[1].id = 'zz-other-valid-id';
        if (kind === 'wrong-terminal-status')
          receipt.after.status = method === 'cancel' ? 'CLOSED' : 'CANCELLED';
        if (kind === 'item-order') receipt.after.items.reverse();
        if (kind === 'allocation-change') {
          receipt.after.items[1].quantity = 3;
          receipt.after.items[1].cancelledQuantity = 3;
          recalculate(receipt.after.items[1]);
        }
        if (kind === 'delivery-change') {
          // Valid allocation/zero outstanding, but historical counts changed.
          receipt.after.items[1].deliveredQuantity = 1;
          receipt.after.items[1].returnedQuantity = 1;
          receipt.after.items[1].cancelledQuantity = 1;
          recalculate(receipt.after.items[1]);
        }
        if (kind === 'return-change') {
          // Isolate the returned counter with otherwise-valid count invariants.
          receipt.after.items[0].deliveredQuantity = 1;
          receipt.after.items[0].returnedQuantity = 0;
          receipt.after.items[0].cancelledQuantity = 1;
          recalculate(receipt.after.items[0]);
        }
        if (kind === 'release-delta') {
          receipt.after.items[1].cancelledQuantity = 1;
          recalculate(receipt.after.items[1]);
        }
        if (kind === 'derived') receipt.after.items[1].reservedRemaining = 99;
        if (kind === 'itemIds') receipt.itemIds = [loan.items[0].id];
        if (kind === 'releases') receipt.releases[1].quantity = 1;
        if (kind === 'release-private') receipt.releases[0].private = true;
        if (kind === 'no-delivery-close-or-delivered-cancel') {
          for (const projection of [receipt.before, receipt.after]) {
            projection.items[0].deliveredQuantity = method === 'cancel' ? 1 : 0;
            projection.items[0].returnedQuantity = method === 'cancel' ? 1 : 0;
            projection.items[0].cancelledQuantity =
              projection === receipt.before ? 0 : method === 'cancel' ? 1 : 2;
            recalculate(projection.items[0]);
          }
          receipt.releases[0].quantity = method === 'cancel' ? 1 : 2;
        }
        const before = structuredClone(h.state());
        h.calls.length = 0;
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, userId: 'other' }),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.state()).toEqual(before);
        expect(h.calls).toEqual([]);
        expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
        expect(h.db.product.findFirst).not.toHaveBeenCalled();
      },
    );
    it.each(
      (
        [
          [CounterpartyType.CUSTOMER, 'customerId'],
          [CounterpartyType.SUPPLIER, 'supplierId'],
          [CounterpartyType.EMPLOYEE, 'employeeId'],
        ] as const
      ).flatMap(([counterpartyType, selected]) =>
        (['customerId', 'supplierId', 'employeeId'] as const).flatMap((field) =>
          (field === selected
            ? ['', ' ', null, 7, undefined]
            : ['', ' ', personId, 7, undefined]
          ).map((value) => ({ counterpartyType, field, value })),
        ),
      ),
    )(
      'rejects symmetric counterparty corruption %j',
      async ({ counterpartyType, field, value }) => {
        const { h, loan, input, receipt } = await completed(counterpartyType);
        receipt.before[field] = receipt.after[field] = value;
        const before = structuredClone(h.state());
        h.calls.length = 0;
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, userId: 'other' }),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.state()).toEqual(before);
        expect(h.calls).toEqual([]);
        expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      },
    );
    it.each(
      [
        'quantity',
        'deliveredQuantity',
        'returnedQuantity',
        'cancelledQuantity',
      ].flatMap((field) =>
        [-1, 1.5, '1', null, undefined, 2147483648].map((value) => ({
          field,
          value,
        })),
      ),
    )(
      'rejects malformed stored count $field=$value without fallback',
      async ({ field, value }) => {
        const { h, loan, input, receipt } = await completed();
        receipt.before.items[1][field] = value;
        h.calls.length = 0;
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, userId: 'other' }),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
        expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      },
    );
    it.each([null, {}, { receiptVersion: 1 }, { private: 'never-public' }])(
      'rejects invalid stored terminal receipt %j',
      async (resultSnapshot) => {
        const { h, loan, input } = await completed();
        h.state().operations.at(-1)!.resultSnapshot =
          resultSnapshot as Prisma.JsonValue;
        h.calls.length = 0;
        jest.clearAllMocks();
        await expect(
          h.service[method](loan.id, input, { ...actor, userId: 'other' }),
        ).rejects.toMatchObject({ status: 409 });
        expect(h.calls).toEqual([]);
        expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
      },
    );
    it.each(Object.values(CounterpartyType))(
      'replays valid %s with actor distinct from creator and no private evidence returned',
      async (counterpartyType) => {
        const { h, loan, input, result } = await completed(counterpartyType);
        expect(
          await h.service[method](loan.id, input, {
            ...actor,
            userId: 'other',
          }),
        ).toEqual(result);
        expect(result.createdById).toBe('actor');
        expect(Object.keys(result).sort()).toEqual([
          'createdAt',
          'createdById',
          'customerId',
          'employeeId',
          'id',
          'items',
          'organizationId',
          'status',
          'supplierId',
        ]);
      },
    );
  },
);

describe('tenant-bound inventory reads', () => {
  it('filters live CLOSED loans with identical tenant/status/counterparty page and count predicates', async () => {
    const h = harness();
    const created = await h.service.create(dto, actor);
    const live = h.state().loans[0];
    live.status = 'CLOSED';
    Object.assign(live.items[0], {
      deliveredQuantity: 1,
      returnedQuantity: 1,
      cancelledQuantity: 1,
    });
    h.state().loans.push(
      { ...live, id: 'closed-newer' },
      { ...live, id: 'foreign', organizationId: 'other' },
      { ...live, id: 'open', status: 'OPEN' },
      { ...live, id: 'cancelled', status: 'CANCELLED' },
      { ...live, id: 'other-customer', customerId: 'other' },
    );
    const result = await h.service.findAll(
      {
        status: 'CLOSED',
        counterpartyType: CounterpartyType.CUSTOMER,
        counterpartyId: personId,
        page: 2,
        limit: 1,
      },
      'org',
    );
    expect(result).toMatchObject({
      data: [{ id: 'closed-newer', organizationId: 'org', status: 'CLOSED' }],
      total: 2,
      page: 2,
      limit: 1,
      totalPages: 2,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].items[0]).toMatchObject({
      reservedRemaining: 0,
      outstanding: 0,
    });
    const where = {
      organizationId: 'org',
      status: 'CLOSED',
      customerId: personId,
    };
    const arg = h.db.inventoryLoan.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(where);
    expect(arg).toMatchObject({
      select: { items: { where: { organizationId: 'org' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 1,
      take: 1,
    });
    expect(h.db.inventoryLoan.count).toHaveBeenCalledWith({ where });
    expect(created.status).toBe('OPEN');
    expect(await h.service.create(dto, actor)).toEqual(created);
  });
  it.each(['OPEN', 'CANCELLED'] as const)(
    'retains explicit %s filtering and live status without cross-tenant rows',
    async (status) => {
      const h = harness();
      const created = await h.service.create(dto, actor);
      const live = h.state().loans[0];
      live.status = status;
      h.state().loans.push(
        { ...live, id: 'foreign', organizationId: 'other' },
        { ...live, id: 'closed', status: 'CLOSED' },
        {
          ...live,
          id: 'alternate',
          status: status === 'OPEN' ? 'CANCELLED' : 'OPEN',
        },
      );
      const result = await h.service.findAll({ status }, 'org');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ id: created.id, status });
      expect(result.total).toBe(1);
      const where = { organizationId: 'org', status };
      expect(h.db.inventoryLoan.findMany.mock.calls[0][0].where).toEqual(where);
      expect(h.db.inventoryLoan.count).toHaveBeenCalledWith({ where });
    },
  );
  it('still rejects CLOSED in immutable CREATE evidence without live fallback or writes', async () => {
    const h = harness();
    await h.service.create(dto, actor);
    const stored = h.state().operations[0].resultSnapshot as unknown as Row;
    stored.status = 'CLOSED';
    const before = structuredClone(h.state());
    const effects = [...h.calls];
    await expect(h.service.create(dto, actor)).rejects.toMatchObject({
      status: 409,
    });
    expect(h.state()).toEqual(before);
    expect(h.calls).toEqual(effects);
    expect(h.db.inventoryLoan.findFirst).not.toHaveBeenCalled();
  });
  it('composes identical page/count filters and stable ordering with scoped item projection', async () => {
    const h = harness();
    await h.service.create(dto, actor);
    h.state().loans.push({
      ...h.state().loans[0],
      id: 'foreign',
      organizationId: 'other',
    });
    const query = {
      status: 'OPEN' as const,
      counterpartyType: CounterpartyType.CUSTOMER,
      counterpartyId: personId,
      page: 1,
      limit: 1,
    };
    const result = await h.service.findAll(query, 'org');
    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 1,
      totalPages: 1,
    });
    const arg = h.db.inventoryLoan.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      organizationId: 'org',
      status: 'OPEN',
      customerId: personId,
    });
    expect(h.db.inventoryLoan.count).toHaveBeenCalledWith({ where: arg.where });
    expect(arg).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
      skip: 0,
      select: { items: { where: { organizationId: 'org' } } },
    });
    expect(arg.select).not.toHaveProperty('operations');
    expect(arg.select).not.toHaveProperty('createdBy');
    expect(result.data[0]).not.toHaveProperty('requestPayload');
  });
  it('detail derives live remaining/outstanding and excludes foreign related items', async () => {
    const h = harness();
    const created = await h.service.create(dto, actor);
    h.state().loans[0].items[0].deliveredQuantity = 2;
    h.state().loans[0].items[0].returnedQuantity = 1;
    h.state().loans[0].items.push({
      ...h.state().loans[0].items[0],
      id: 'foreign',
      organizationId: 'other',
    });
    const result = await h.service.findOne(created.id, 'org');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      reservedRemaining: 0,
      outstanding: 1,
    });
    expect(result).not.toHaveProperty('operations');
  });
  it.each(['other', 'missing'])(
    'returns scoped 404 for %s detail/history',
    async (scope) => {
      const h = harness();
      const created = await h.service.create(dto, actor);
      await expect(
        h.service.findOne(
          scope === 'missing' ? scope : created.id,
          scope === 'other' ? scope : 'org',
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        h.service.history(
          scope === 'missing' ? scope : created.id,
          {},
          scope === 'other' ? scope : 'org',
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(h.db.inventoryLoanEvent.findMany).not.toHaveBeenCalled();
    },
  );
  it('history shares scoped count/page, stable ordering and minimal immutable event fields', async () => {
    const h = harness();
    const loan = await h.service.create(dto, actor);
    h.state().events.push({
      ...h.state().events[0],
      id: 'foreign',
      organizationId: 'other',
    });
    const result = await h.service.history(
      loan.id,
      { page: 1, limit: 1 },
      'org',
    );
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      createdById: 'actor',
      type: 'CREATED',
      itemId: null,
      quantity: null,
    });
    const arg = h.db.inventoryLoanEvent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ loanId: loan.id, organizationId: 'org' });
    expect(h.db.inventoryLoanEvent.count).toHaveBeenCalledWith({
      where: arg.where,
    });
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(arg.select).toEqual({
      id: true,
      loanId: true,
      itemId: true,
      type: true,
      quantity: true,
      createdById: true,
      createdAt: true,
    });
    expect(result.data[0]).not.toHaveProperty('operationId');
  });
  it('bounds pagination and rejects unsupported filters', async () => {
    const h = harness();
    expect(
      await h.service.findAll({ page: Infinity, limit: -1 }, 'org'),
    ).toMatchObject({ page: 1, limit: 1 });
    expect(
      await h.service.findAll({ page: 2000000, limit: 200 }, 'org'),
    ).toMatchObject({ page: 1000000, limit: 100 });
    await expect(
      h.service.findAll({ status: 'INVALID' as 'OPEN' }, 'org'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.findAll({ counterpartyType: CounterpartyType.CUSTOMER }, 'org'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.findAll({ counterpartyId: personId }, 'org'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('fails closed without tenant for every read method', async () => {
    const h = harness();
    await expect(h.service.findAll({}, undefined)).rejects.toMatchObject({
      status: 403,
    });
    await expect(h.service.findOne('id', undefined)).rejects.toMatchObject({
      status: 403,
    });
    await expect(h.service.history('id', {}, undefined)).rejects.toMatchObject({
      status: 403,
    });
  });
});
