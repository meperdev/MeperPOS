import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryLoanOperation,
  InventoryLoanStatus,
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
import {
  deriveInventoryLoanQuantities,
  InventoryLoanCounts,
  planInventoryLoanClose,
  transitionInventoryLoanItem,
} from './inventory-loan.invariants';

const itemSelect = {
  id: true,
  productId: true,
  quantity: true,
  deliveredQuantity: true,
  returnedQuantity: true,
  cancelledQuantity: true,
} as const;
function loanSelect(organizationId: string) {
  return {
    id: true,
    organizationId: true,
    status: true,
    createdById: true,
    createdAt: true,
    customerId: true,
    supplierId: true,
    employeeId: true,
    items: {
      where: { organizationId },
      select: itemSelect,
      orderBy: { id: 'asc' as const },
    },
  } satisfies Prisma.InventoryLoanSelect;
}
type Loan = Prisma.InventoryLoanGetPayload<{
  select: ReturnType<typeof loanSelect>;
}>;
function present(loan: Loan) {
  return {
    ...loan,
    createdAt: loan.createdAt.toISOString(),
    items: loan.items.map((item) => ({
      ...item,
      ...deriveInventoryLoanQuantities(item),
    })),
  };
}
type Snapshot = ReturnType<typeof present>;
export interface InventoryLoanQuery {
  page?: number;
  limit?: number;
  status?: InventoryLoanStatus;
  counterpartyType?: CounterpartyType;
  counterpartyId?: string;
}
function organization(id: string | undefined): string {
  if (!id || !id.trim())
    throw new ForbiddenException(
      'Seleccione una organización para operar préstamos',
    );
  return id;
}
function normalize(input: CreateInventoryLoanDto) {
  const dto = plainToInstance(CreateInventoryLoanDto, input);
  if (
    validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }).length
  ) {
    throw new BadRequestException(
      'Solicitud de préstamo de inventario inválida',
    );
  }
  if (
    new Set(dto.items.map((item) => item.productId)).size !== dto.items.length
  ) {
    throw new BadRequestException('Los productos no pueden repetirse');
  }
  // Item order is not semantic. This also gives every writer the same lock order.
  dto.items.sort((a, b) => a.productId.localeCompare(b.productId));
  return dto;
}
function payload(dto: CreateInventoryLoanDto): Prisma.InputJsonObject {
  return {
    type: 'CREATE',
    counterpartyType: dto.counterpartyType,
    customerId:
      dto.counterpartyType === CounterpartyType.CUSTOMER
        ? dto.counterpartyId
        : null,
    supplierId:
      dto.counterpartyType === CounterpartyType.SUPPLIER
        ? dto.counterpartyId
        : null,
    employeeId:
      dto.counterpartyType === CounterpartyType.EMPLOYEE
        ? dto.counterpartyId
        : null,
    items: dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(',') === keys.sort().join(',');
}
// Validate the completed CREATE shape, not a live loan fallback. No private fields survive.
function snapshot(operation: InventoryLoanOperation): Snapshot {
  const result: unknown = operation.resultSnapshot;
  const invalid = () =>
    new ConflictException('Resultado de solicitud inválido');
  if (
    !object(result) ||
    !exactKeys(result, [
      'id',
      'organizationId',
      'status',
      'createdById',
      'createdAt',
      'customerId',
      'supplierId',
      'employeeId',
      'items',
    ]) ||
    result.id !== operation.loanId ||
    result.organizationId !== operation.organizationId ||
    result.createdById !== operation.actorId ||
    result.status !== 'OPEN' ||
    typeof result.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(result.createdAt)) ||
    !Array.isArray(result.items) ||
    !result.items.length ||
    result.items.length > 100
  )
    throw invalid();
  const ids = [result.customerId, result.supplierId, result.employeeId];
  if (
    ids.filter((id) => id !== null).length !== 1 ||
    ids.some(
      (id) => id !== null && (typeof id !== 'string' || id.trim().length === 0),
    )
  )
    throw invalid();
  const products = new Set<string>();
  for (const item of result.items) {
    if (
      !object(item) ||
      !exactKeys(item, [
        'id',
        'productId',
        'quantity',
        'deliveredQuantity',
        'returnedQuantity',
        'cancelledQuantity',
        'reservedRemaining',
        'outstanding',
      ]) ||
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.productId !== 'string' ||
      !item.productId ||
      products.has(item.productId) ||
      !Number.isInteger(item.quantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > 2147483647 ||
      item.deliveredQuantity !== 0 ||
      item.returnedQuantity !== 0 ||
      item.cancelledQuantity !== 0 ||
      item.reservedRemaining !== item.quantity ||
      item.outstanding !== 0
    )
      throw invalid();
    products.add(item.productId);
  }
  return result as Snapshot;
}
function replay(
  operation: InventoryLoanOperation,
  actorId: string,
  request: Prisma.InputJsonObject,
) {
  if (
    operation.actorId !== actorId ||
    operation.type !== 'CREATE' ||
    canonical(operation.requestPayload) !== canonical(request)
  ) {
    throw new ConflictException('La clave ya pertenece a otra solicitud');
  }
  return snapshot(operation);
}
type ServicingType = 'DELIVER' | 'RETURN';
const countKeys = [
  'quantity',
  'deliveredQuantity',
  'returnedQuantity',
  'cancelledQuantity',
];
function counts(item: InventoryLoanCounts): InventoryLoanCounts {
  return {
    quantity: item.quantity,
    deliveredQuantity: item.deliveredQuantity,
    returnedQuantity: item.returnedQuantity,
    cancelledQuantity: item.cancelledQuantity,
  };
}
function boundedInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 2147483647;
}
function normalizeOperation(input: InventoryLoanOperationDto) {
  if (!object(input)) throw new BadRequestException('Solicitud inválida');
  const dto = plainToInstance(InventoryLoanOperationDto, input);
  if (
    validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }).length ||
    new Set(dto.items.map((item) => item.itemId)).size !== dto.items.length
  ) {
    throw new BadRequestException('Items o cantidades inválidos');
  }
  dto.items.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return dto;
}

// DELIVER/RETURN receipts are deliberately separate from the frozen CREATE parser.
// Both full count projections let replay prove selected deltas and untouched items.
function servicingProjection(
  value: unknown,
  operation: InventoryLoanOperation,
): Snapshot {
  const invalid = () =>
    new ConflictException('Resultado de solicitud inválido');
  if (
    !object(value) ||
    !exactKeys(value, [
      'id',
      'organizationId',
      'status',
      'createdById',
      'createdAt',
      'customerId',
      'supplierId',
      'employeeId',
      'items',
    ]) ||
    value.id !== operation.loanId ||
    value.organizationId !== operation.organizationId ||
    value.status !== 'OPEN' ||
    typeof value.createdById !== 'string' ||
    !value.createdById.trim() ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > 100
  )
    throw invalid();
  const counterparties = [value.customerId, value.supplierId, value.employeeId];
  if (
    counterparties.filter((id) => id !== null).length !== 1 ||
    counterparties.some(
      (id) => id !== null && (typeof id !== 'string' || !id.trim()),
    )
  )
    throw invalid();
  const ids = new Set<string>();
  let last = '';
  for (const item of value.items) {
    if (
      !object(item) ||
      !exactKeys(item, [
        'id',
        'productId',
        ...countKeys,
        'reservedRemaining',
        'outstanding',
      ]) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      ids.has(item.id) ||
      (last && last.localeCompare(item.id) >= 0) ||
      typeof item.productId !== 'string' ||
      !item.productId.trim()
    )
      throw invalid();
    ids.add(item.id);
    last = item.id;
    try {
      const derived = deriveInventoryLoanQuantities(
        item as unknown as InventoryLoanCounts,
      );
      if (
        derived.reservedRemaining !== item.reservedRemaining ||
        derived.outstanding !== item.outstanding
      )
        throw invalid();
    } catch {
      throw invalid();
    }
  }
  return value as Snapshot;
}
function servicingReplay(
  operation: InventoryLoanOperation,
  actorId: string,
  orgId: string,
  requestKey: string,
  type: ServicingType,
  request: Prisma.InputJsonObject,
  selected: InventoryLoanOperationDto['items'],
): Snapshot {
  const invalid = () =>
    new ConflictException('Resultado de solicitud inválido');
  if (
    operation.actorId !== actorId ||
    operation.organizationId !== orgId ||
    operation.requestKey !== requestKey ||
    operation.type !== type ||
    operation.loanId !== request.loanId ||
    canonical(operation.requestPayload) !== canonical(request)
  ) {
    throw new ConflictException('La clave ya pertenece a otra solicitud');
  }
  const receipt: unknown = operation.resultSnapshot;
  if (
    !object(receipt) ||
    !exactKeys(receipt, [
      'receiptVersion',
      'type',
      'actorId',
      'itemIds',
      'before',
      'after',
    ]) ||
    receipt.receiptVersion !== 1 ||
    receipt.type !== type ||
    receipt.actorId !== actorId
  )
    throw invalid();
  const before = servicingProjection(receipt.before, operation);
  const after = servicingProjection(receipt.after, operation);
  if (
    canonical(receipt.itemIds) !==
    canonical(before.items.map((item) => item.id))
  )
    throw invalid();
  const { items: beforeItems, ...beforeHeader } = before;
  const { items: afterItems, ...afterHeader } = after;
  if (
    canonical(beforeHeader) !== canonical(afterHeader) ||
    beforeItems.length !== afterItems.length
  )
    throw invalid();
  const quantities = new Map(
    selected.map((item) => [item.itemId, item.quantity]),
  );
  for (let index = 0; index < beforeItems.length; index++) {
    const prior = beforeItems[index];
    const next = afterItems[index];
    if (prior.id !== next.id || prior.productId !== next.productId)
      throw invalid();
    const quantity = quantities.get(prior.id);
    try {
      const expected =
        quantity === undefined
          ? counts(prior)
          : transitionInventoryLoanItem(
              counts(prior),
              type === 'DELIVER' ? 'DELIVERED' : 'RETURNED',
              quantity,
            ).counts;
      if (canonical(expected) !== canonical(counts(next))) throw invalid();
    } catch {
      throw invalid();
    }
    quantities.delete(prior.id);
  }
  if (quantities.size) throw invalid();
  // Only the validated public projection escapes; no private evidence/payload fallback.
  return after;
}
type TerminalType = 'CANCEL' | 'CLOSE';
function terminalStatus(type: TerminalType): 'CANCELLED' | 'CLOSED' {
  return type === 'CANCEL' ? 'CANCELLED' : 'CLOSED';
}
function normalizeTerminal(input: InventoryLoanTerminalDto) {
  if (!object(input)) throw new BadRequestException('Solicitud inválida');
  const dto = plainToInstance(InventoryLoanTerminalDto, input);
  if (
    validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }).length
  )
    throw new BadRequestException('Clave de solicitud inválida');
  return dto;
}
function terminalPlan(
  items: readonly InventoryLoanCounts[],
  type: TerminalType,
) {
  try {
    if (type === 'CLOSE') return planInventoryLoanClose(items);
    if (!items.length) throw new Error('Nonempty items required');
    return items.map((item) => {
      const { reservedRemaining } = deriveInventoryLoanQuantities(item);
      if (item.deliveredQuantity !== 0)
        throw new Error('Historical delivery requires CLOSE');
      const next = {
        ...counts(item),
        cancelledQuantity: item.cancelledQuantity + reservedRemaining,
      };
      return {
        counts: next,
        ...deriveInventoryLoanQuantities(next),
        releaseQuantity: reservedRemaining,
      };
    });
  } catch {
    throw new ConflictException(
      'Cancelación requiere cero entregas; cierre requiere entregas totalmente devueltas',
    );
  }
}

// Independent strict parser: CREATE and DELIVER/RETURN contracts stay frozen.
function terminalProjection(
  value: unknown,
  operation: Pick<InventoryLoanOperation, 'loanId' | 'organizationId'>,
  status: InventoryLoanStatus,
): Snapshot {
  const invalid = () => new ConflictException('Resultado terminal inválido');
  if (
    !object(value) ||
    !exactKeys(value, [
      'id',
      'organizationId',
      'status',
      'createdById',
      'createdAt',
      'customerId',
      'supplierId',
      'employeeId',
      'items',
    ]) ||
    value.id !== operation.loanId ||
    value.organizationId !== operation.organizationId ||
    value.status !== status ||
    typeof value.createdById !== 'string' ||
    !value.createdById.trim() ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > 100
  )
    throw invalid();
  const counterparties = [value.customerId, value.supplierId, value.employeeId];
  if (
    counterparties.filter((id) => id !== null).length !== 1 ||
    counterparties.some(
      (id) => id !== null && (typeof id !== 'string' || !id.trim()),
    )
  )
    throw invalid();
  const ids = new Set<string>();
  let last = '';
  for (const item of value.items) {
    if (
      !object(item) ||
      !exactKeys(item, [
        'id',
        'productId',
        ...countKeys,
        'reservedRemaining',
        'outstanding',
      ]) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      ids.has(item.id) ||
      (last && last.localeCompare(item.id) >= 0) ||
      typeof item.productId !== 'string' ||
      !item.productId.trim()
    )
      throw invalid();
    ids.add(item.id);
    last = item.id;
    try {
      const derived = deriveInventoryLoanQuantities(
        item as unknown as InventoryLoanCounts,
      );
      if (
        derived.reservedRemaining !== item.reservedRemaining ||
        derived.outstanding !== item.outstanding
      )
        throw invalid();
    } catch {
      throw invalid();
    }
  }
  return value as Snapshot;
}
function terminalReplay(
  operation: InventoryLoanOperation,
  actorId: string,
  orgId: string,
  requestKey: string,
  type: TerminalType,
  request: Prisma.InputJsonObject,
): Snapshot {
  const invalid = () => new ConflictException('Resultado terminal inválido');
  if (
    operation.actorId !== actorId ||
    operation.organizationId !== orgId ||
    operation.requestKey !== requestKey ||
    operation.type !== type ||
    operation.loanId !== request.loanId ||
    canonical(operation.requestPayload) !== canonical(request)
  )
    throw new ConflictException('La clave ya pertenece a otra solicitud');
  const receipt: unknown = operation.resultSnapshot;
  if (
    !object(receipt) ||
    !exactKeys(receipt, [
      'receiptVersion',
      'type',
      'actorId',
      'itemIds',
      'releases',
      'before',
      'after',
    ]) ||
    receipt.receiptVersion !== 1 ||
    receipt.type !== type ||
    receipt.actorId !== actorId
  )
    throw invalid();
  const before = terminalProjection(receipt.before, operation, 'OPEN');
  const after = terminalProjection(
    receipt.after,
    operation,
    terminalStatus(type),
  );
  if (
    canonical(receipt.itemIds) !==
    canonical(before.items.map((item) => item.id))
  )
    throw invalid();
  const plan = terminalPlan(before.items, type);
  const expected = {
    ...before,
    status: terminalStatus(type),
    items: before.items.map((item, index) => ({
      id: item.id,
      productId: item.productId,
      ...plan[index].counts,
      ...deriveInventoryLoanQuantities(plan[index].counts),
    })),
  };
  const releases = before.items.flatMap((item, index) =>
    plan[index].releaseQuantity
      ? [{ itemId: item.id, quantity: plan[index].releaseQuantity }]
      : [],
  );
  if (
    canonical(after) !== canonical(expected) ||
    canonical(receipt.releases) !== canonical(releases)
  )
    throw invalid();
  return after;
}

function page(query: InventoryLoanQuery) {
  const bounded = (value: number | undefined, fallback: number, max: number) =>
    value === undefined
      ? fallback
      : Number.isFinite(value)
        ? Math.min(max, Math.max(1, Math.trunc(value)))
        : fallback;
  const page = bounded(query.page, 1, 1000000);
  const limit = bounded(query.limit, 20, 100);
  return { page, limit, skip: (page - 1) * limit };
}

// Deliberately NOT registered in any Nest module or controller. L3C-C gates rollout.
@Injectable()
export class InventoryLoansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateInventoryLoanDto, actor: RequestUser) {
    const orgId = organization(actor?.organizationId);
    if (
      !actor.userId ||
      ![OrgRole.OWNER, OrgRole.ADMIN, 'SUPER_ADMIN'].includes(actor.role)
    ) {
      throw new ForbiddenException('No tiene permisos para crear préstamos');
    }
    const dto = normalize(input);
    const request = payload(dto);
    const key = {
      organizationId_requestKey: {
        organizationId: orgId,
        requestKey: dto.requestKey,
      },
    };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Even SUPER_ADMIN needs a real active, administrative same-tenant membership.
          const member = await tx.organizationUser.findFirst({
            where: {
              organizationId: orgId,
              userId: actor.userId,
              role: { in: [OrgRole.OWNER, OrgRole.ADMIN] },
              user: { active: true },
            },
            select: { userId: true },
          });
          if (!member)
            throw new ForbiddenException(
              'Administrador activo de la organización requerido',
            );
          const previous = await tx.inventoryLoanOperation.findUnique({
            where: key,
          });
          if (previous) return replay(previous, actor.userId, request);
          await this.validateCounterparty(tx, dto, orgId);
          for (const item of dto.items) {
            const product = await tx.product.findFirst({
              where: {
                id: item.productId,
                organizationId: orgId,
                active: true,
                type: 'PRODUCT',
                tracksStock: true,
              },
              select: {
                id: true,
                stock: true,
                reservedStock: true,
                version: true,
                type: true,
                tracksStock: true,
              },
            });
            if (!product)
              throw new BadRequestException(
                'Producto activo con inventario requerido',
              );
            if (
              ![product.stock, product.reservedStock, product.version].every(
                (n) => Number.isInteger(n) && n >= 0 && n <= 2147483647,
              ) ||
              product.reservedStock > product.stock ||
              product.type !== 'PRODUCT' ||
              product.tracksStock !== true ||
              product.stock - product.reservedStock < item.quantity ||
              product.version === 2147483647
            ) {
              throw new ConflictException(
                'Inventario disponible insuficiente o inválido',
              );
            }
            const changed = await tx.product.updateMany({
              where: {
                id: item.productId,
                organizationId: orgId,
                active: true,
                type: 'PRODUCT',
                tracksStock: true,
                version: product.version,
                reservedStock: product.reservedStock,
                stock: {
                  equals: product.stock,
                  gte: product.reservedStock + item.quantity,
                },
              },
              data: {
                reservedStock: { increment: item.quantity },
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1)
              throw new ConflictException(
                'El inventario cambió; reintente con la misma clave',
              );
          }
          const loan = await tx.inventoryLoan.create({
            data: {
              organizationId: orgId,
              createdById: actor.userId,
              customerId:
                dto.counterpartyType === CounterpartyType.CUSTOMER
                  ? dto.counterpartyId
                  : null,
              supplierId:
                dto.counterpartyType === CounterpartyType.SUPPLIER
                  ? dto.counterpartyId
                  : null,
              employeeId:
                dto.counterpartyType === CounterpartyType.EMPLOYEE
                  ? dto.counterpartyId
                  : null,
              items: {
                create: dto.items.map((item) => ({
                  ...item,
                  organizationId: orgId,
                })),
              },
            },
            select: loanSelect(orgId),
          });
          const result = present(loan);
          const operation = await tx.inventoryLoanOperation.create({
            data: {
              organizationId: orgId,
              loanId: loan.id,
              actorId: actor.userId,
              type: 'CREATE',
              requestKey: dto.requestKey,
              requestPayload: request,
              resultSnapshot: result,
            },
          });
          await tx.inventoryLoanEvent.create({
            data: {
              loanId: loan.id,
              organizationId: orgId,
              createdById: actor.userId,
              type: 'CREATED',
              operationId: operation.id,
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId: orgId,
              userId: actor.userId,
              action: 'INVENTORY_LOAN_CREATED',
              resource: 'InventoryLoan',
              resourceId: loan.id,
              metadata: { operationId: operation.id },
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        // Only outside the aborted transaction: never blindly repeat reservations.
        const previous = await this.prisma.inventoryLoanOperation.findUnique({
          where: key,
        });
        if (previous) return replay(previous, actor.userId, request);
        throw new ConflictException(
          'Conflicto de inventario; reintente con la misma clave',
        );
      }
      throw error;
    }
  }

  async deliver(
    id: string,
    input: InventoryLoanOperationDto,
    actor: RequestUser,
  ) {
    return this.serviceItems(id, input, actor, 'DELIVER');
  }

  async returnItems(
    id: string,
    input: InventoryLoanOperationDto,
    actor: RequestUser,
  ) {
    return this.serviceItems(id, input, actor, 'RETURN');
  }

  async cancel(
    id: string,
    input: InventoryLoanTerminalDto,
    actor: RequestUser,
  ) {
    return this.terminate(id, input, actor, 'CANCEL');
  }

  async close(id: string, input: InventoryLoanTerminalDto, actor: RequestUser) {
    return this.terminate(id, input, actor, 'CLOSE');
  }

  private async authorizeTerminal(
    tx: Pick<Prisma.TransactionClient, 'organizationUser'>,
    orgId: string,
    actorId: string,
  ) {
    const member = await tx.organizationUser.findFirst({
      where: {
        organizationId: orgId,
        userId: actorId,
        role: { in: [OrgRole.OWNER, OrgRole.ADMIN] },
        user: { active: true },
      },
      select: { userId: true },
    });
    if (!member)
      throw new ForbiddenException(
        'Administrador activo de la organización requerido',
      );
  }

  private async terminate(
    id: string,
    input: InventoryLoanTerminalDto,
    actor: RequestUser,
    type: TerminalType,
  ) {
    const orgId = organization(actor?.organizationId);
    if (
      typeof actor.userId !== 'string' ||
      !actor.userId.trim() ||
      ![OrgRole.OWNER, OrgRole.ADMIN, 'SUPER_ADMIN'].includes(actor.role)
    )
      throw new ForbiddenException('Administrador activo requerido');
    if (typeof id !== 'string' || !id.trim())
      throw new BadRequestException('Préstamo inválido');
    const dto = normalizeTerminal(input);
    const request: Prisma.InputJsonObject = { type, loanId: id };
    const key = {
      organizationId_requestKey: {
        organizationId: orgId,
        requestKey: dto.requestKey,
      },
    };
    const replayResult = (op: InventoryLoanOperation) =>
      terminalReplay(op, actor.userId, orgId, dto.requestKey, type, request);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.authorizeTerminal(tx, orgId, actor.userId);
          const previous = await tx.inventoryLoanOperation.findUnique({
            where: key,
          });
          if (previous) return replayResult(previous);
          const loan = await tx.inventoryLoan.findFirst({
            where: { id, organizationId: orgId },
            select: {
              ...loanSelect(orgId),
              version: true,
              items: {
                select: { ...itemSelect, organizationId: true, loanId: true },
                orderBy: { id: 'asc' },
              },
            },
          });
          if (!loan) throw new NotFoundException('Préstamo no encontrado');
          if (
            loan.id !== id ||
            loan.organizationId !== orgId ||
            loan.status !== 'OPEN' ||
            !boundedInt(loan.version) ||
            loan.version === 2147483647
          )
            throw new ConflictException(
              'Préstamo no abierto o versión inválida',
            );
          if (
            loan.items.some(
              (item) => item.organizationId !== orgId || item.loanId !== id,
            )
          )
            throw new ConflictException('Item fuera del préstamo');
          const { version, items, ...header } = loan;
          let before: Snapshot;
          try {
            before = present({
              ...header,
              items: items.map(({ organizationId, loanId, ...item }) => {
                void organizationId;
                void loanId;
                return item;
              }),
            });
          } catch {
            throw new ConflictException('Cantidades inválidas');
          }
          const identity = { loanId: id, organizationId: orgId };
          terminalProjection(before, identity, 'OPEN');
          const plan = terminalPlan(before.items, type);
          const claim = await tx.inventoryLoan.updateMany({
            where: { id, organizationId: orgId, status: 'OPEN', version },
            data: { status: terminalStatus(type), version: { increment: 1 } },
          });
          if (claim.count !== 1)
            throw new ConflictException('El préstamo cambió');
          const releases = new Map<string, number>();
          for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const release = plan[index].releaseQuantity;
            // Pin every allocation, including zero-release items; item rows have no version.
            const changed = await tx.inventoryLoanItem.updateMany({
              where: {
                id: item.id,
                loanId: id,
                organizationId: orgId,
                productId: item.productId,
                ...counts(item),
              },
              data: { cancelledQuantity: { increment: release } },
            });
            if (changed.count !== 1)
              throw new ConflictException('El item cambió');
            if (release) {
              const total = (releases.get(item.productId) ?? 0) + release;
              if (!boundedInt(total))
                throw new ConflictException('Cantidad agregada fuera de rango');
              releases.set(item.productId, total);
            }
          }
          // No unique loan/product key exists: aggregate positive releases, one sorted CAS/product.
          for (const [productId, release] of [...releases].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            const product = await tx.product.findFirst({
              where: {
                id: productId,
                organizationId: orgId,
                active: true,
                type: 'PRODUCT',
                tracksStock: true,
              },
              select: {
                id: true,
                organizationId: true,
                active: true,
                type: true,
                tracksStock: true,
                stock: true,
                reservedStock: true,
                version: true,
              },
            });
            if (
              !product ||
              product.id !== productId ||
              product.organizationId !== orgId ||
              product.active !== true ||
              product.type !== 'PRODUCT' ||
              product.tracksStock !== true
            )
              throw new BadRequestException(
                'Producto activo con inventario requerido',
              );
            if (
              ![product.stock, product.reservedStock, product.version].every(
                boundedInt,
              ) ||
              product.version === 2147483647 ||
              product.reservedStock > product.stock ||
              product.reservedStock < release
            )
              throw new ConflictException('Inventario insuficiente o inválido');
            const changed = await tx.product.updateMany({
              where: {
                id: productId,
                organizationId: orgId,
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
            if (changed.count !== 1)
              throw new ConflictException('El inventario cambió');
          }
          const after = {
            ...before,
            status: terminalStatus(type),
            items: before.items.map((item, index) => ({
              id: item.id,
              productId: item.productId,
              ...plan[index].counts,
              ...deriveInventoryLoanQuantities(plan[index].counts),
            })),
          };
          const positiveReleases = before.items.flatMap((item, index) =>
            plan[index].releaseQuantity
              ? [{ itemId: item.id, quantity: plan[index].releaseQuantity }]
              : [],
          );
          const operation = await tx.inventoryLoanOperation.create({
            data: {
              organizationId: orgId,
              loanId: id,
              actorId: actor.userId,
              type,
              requestKey: dto.requestKey,
              requestPayload: request,
              resultSnapshot: {
                receiptVersion: 1,
                type,
                actorId: actor.userId,
                itemIds: before.items.map((item) => item.id),
                releases: positiveReleases,
                before,
                after,
              },
            },
          });
          const result = replayResult(operation);
          for (const release of positiveReleases)
            await tx.inventoryLoanEvent.create({
              data: {
                organizationId: orgId,
                loanId: id,
                ...release,
                type: 'CANCELLED',
                createdById: actor.userId,
                operationId: operation.id,
              },
            });
          await tx.inventoryLoanEvent.create({
            data: {
              organizationId: orgId,
              loanId: id,
              itemId: null,
              quantity: null,
              type: terminalStatus(type),
              createdById: actor.userId,
              operationId: operation.id,
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId: orgId,
              userId: actor.userId,
              action:
                type === 'CANCEL'
                  ? 'INVENTORY_LOAN_CANCELLED'
                  : 'INVENTORY_LOAN_CLOSED',
              resource: 'InventoryLoan',
              resourceId: id,
              metadata: { operationId: operation.id },
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        // Abort reconciliation is outside-only, still authorized, and never retries effects.
        await this.authorizeTerminal(this.prisma, orgId, actor.userId);
        const previous = await this.prisma.inventoryLoanOperation.findUnique({
          where: key,
        });
        if (previous) return replayResult(previous);
        throw new ConflictException(
          'Conflicto de inventario; reintente con la misma clave',
        );
      }
      throw error;
    }
  }

  private async serviceItems(
    id: string,
    input: InventoryLoanOperationDto,
    actor: RequestUser,
    type: ServicingType,
  ) {
    const orgId = organization(actor?.organizationId);
    if (
      !actor.userId ||
      ![OrgRole.OWNER, OrgRole.ADMIN, 'SUPER_ADMIN'].includes(actor.role)
    ) {
      throw new ForbiddenException('Administrador activo requerido');
    }
    if (typeof id !== 'string' || !id.trim())
      throw new BadRequestException('Préstamo inválido');
    const dto = normalizeOperation(input);
    const request: Prisma.InputJsonObject = {
      type,
      loanId: id,
      items: dto.items.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
      })),
    };
    const key = {
      organizationId_requestKey: {
        organizationId: orgId,
        requestKey: dto.requestKey,
      },
    };
    const replayResult = (op: InventoryLoanOperation) =>
      servicingReplay(
        op,
        actor.userId,
        orgId,
        dto.requestKey,
        type,
        request,
        dto.items,
      );
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const member = await tx.organizationUser.findFirst({
            where: {
              organizationId: orgId,
              userId: actor.userId,
              role: { in: [OrgRole.OWNER, OrgRole.ADMIN] },
              user: { active: true },
            },
            select: { userId: true },
          });
          if (!member)
            throw new ForbiddenException(
              'Administrador activo de la organización requerido',
            );
          const previous = await tx.inventoryLoanOperation.findUnique({
            where: key,
          });
          if (previous) return replayResult(previous);
          const loan = await tx.inventoryLoan.findFirst({
            where: { id, organizationId: orgId },
            select: {
              ...loanSelect(orgId),
              version: true,
              items: {
                where: { organizationId: orgId, loanId: id },
                select: itemSelect,
                orderBy: { id: 'asc' },
              },
            },
          });
          if (!loan) throw new NotFoundException('Préstamo no encontrado');
          if (
            loan.status !== 'OPEN' ||
            !boundedInt(loan.version) ||
            loan.version === 2147483647
          )
            throw new ConflictException(
              'Préstamo no abierto o versión inválida',
            );
          // Version is a concurrency guard, never part of the public CREATE/result shape.
          const { version, ...publicLoan } = loan;
          let before: Snapshot;
          try {
            before = present(publicLoan);
          } catch {
            throw new ConflictException('Cantidades inválidas');
          }
          const proposals = dto.items.map((selected) => {
            const item = loan.items.find((item) => item.id === selected.itemId);
            if (!item)
              throw new NotFoundException('Item del préstamo no encontrado');
            try {
              return {
                item,
                quantity: selected.quantity,
                ...transitionInventoryLoanItem(
                  counts(item),
                  type === 'DELIVER' ? 'DELIVERED' : 'RETURNED',
                  selected.quantity,
                ),
              };
            } catch {
              throw new ConflictException(
                'Cantidad excede la obligación pendiente',
              );
            }
          });
          const claim = await tx.inventoryLoan.updateMany({
            where: { id, organizationId: orgId, status: 'OPEN', version },
            data: { version: { increment: 1 } },
          });
          if (claim.count !== 1)
            throw new ConflictException('El préstamo cambió');
          const deltas = new Map<string, { stock: number; reserved: number }>();
          for (const proposal of proposals) {
            const { item } = proposal;
            const changed = await tx.inventoryLoanItem.updateMany({
              where: {
                id: item.id,
                loanId: id,
                organizationId: orgId,
                productId: item.productId,
                ...counts(item),
              },
              data:
                type === 'DELIVER'
                  ? { deliveredQuantity: { increment: proposal.quantity } }
                  : { returnedQuantity: { increment: proposal.quantity } },
            });
            if (changed.count !== 1)
              throw new ConflictException('El item cambió');
            const delta = deltas.get(item.productId) ?? {
              stock: 0,
              reserved: 0,
            };
            delta.stock += proposal.stockDelta;
            delta.reserved += proposal.reservationDelta;
            if (
              !boundedInt(Math.abs(delta.stock)) ||
              !boundedInt(Math.abs(delta.reserved))
            )
              throw new ConflictException('Cantidad agregada fuera de rango');
            deltas.set(item.productId, delta);
          }
          const movementStocks = new Map<string, number>();
          // Actual schema has no unique loan/product key: aggregate defensively, one CAS/product.
          for (const [productId, delta] of [...deltas].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            const product = await tx.product.findFirst({
              where: {
                id: productId,
                organizationId: orgId,
                type: 'PRODUCT',
                tracksStock: true,
                ...(type === 'DELIVER' ? { active: true } : {}),
              },
              select: {
                id: true,
                active: true,
                type: true,
                tracksStock: true,
                stock: true,
                reservedStock: true,
                version: true,
              },
            });
            if (
              !product ||
              product.type !== 'PRODUCT' ||
              product.tracksStock !== true ||
              typeof product.active !== 'boolean' ||
              (type === 'DELIVER' && !product.active)
            )
              throw new BadRequestException(
                'Producto físico con inventario requerido',
              );
            if (
              ![product.stock, product.reservedStock, product.version].every(
                boundedInt,
              ) ||
              product.version === 2147483647 ||
              product.reservedStock > product.stock ||
              (!product.active && product.reservedStock !== 0) ||
              !boundedInt(product.stock + delta.stock) ||
              !boundedInt(product.reservedStock + delta.reserved) ||
              product.reservedStock + delta.reserved >
                product.stock + delta.stock
            )
              throw new ConflictException('Inventario insuficiente o inválido');
            movementStocks.set(productId, product.stock);
            const changed = await tx.product.updateMany({
              where: {
                id: productId,
                organizationId: orgId,
                type: 'PRODUCT',
                tracksStock: true,
                active: type === 'DELIVER' ? true : product.active,
                version: product.version,
                stock: {
                  equals: product.stock,
                  gte: Math.max(0, -delta.stock),
                },
                reservedStock: {
                  equals: product.reservedStock,
                  gte: Math.max(0, -delta.reserved),
                },
              },
              data: {
                stock: { increment: delta.stock },
                ...(delta.reserved
                  ? { reservedStock: { increment: delta.reserved } }
                  : {}),
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1)
              throw new ConflictException('El inventario cambió');
          }
          const after = {
            ...before,
            items: before.items.map((item) => {
              const proposal = proposals.find(
                (entry) => entry.item.id === item.id,
              );
              const next = proposal?.counts ?? counts(item);
              return {
                id: item.id,
                productId: item.productId,
                ...next,
                ...deriveInventoryLoanQuantities(next),
              };
            }),
          };
          const operation = await tx.inventoryLoanOperation.create({
            data: {
              organizationId: orgId,
              loanId: id,
              actorId: actor.userId,
              type,
              requestKey: dto.requestKey,
              requestPayload: request,
              resultSnapshot: {
                receiptVersion: 1,
                type,
                actorId: actor.userId,
                itemIds: before.items.map((item) => item.id),
                before,
                after,
              },
            },
          });
          const result = replayResult(operation);
          // Proposals retain normalized item order; shared products chain from the pre-CAS stock.
          for (const proposal of proposals) {
            const { item, quantity, stockDelta } = proposal;
            const previousStock = movementStocks.get(item.productId);
            if (
              previousStock === undefined ||
              !boundedInt(previousStock) ||
              !boundedInt(previousStock + stockDelta)
            )
              throw new ConflictException('Inventario insuficiente o inválido');
            const newStock = previousStock + stockDelta;
            const event = await tx.inventoryLoanEvent.create({
              data: {
                organizationId: orgId,
                loanId: id,
                itemId: item.id,
                quantity,
                type: type === 'DELIVER' ? 'DELIVERED' : 'RETURNED',
                createdById: actor.userId,
                operationId: operation.id,
              },
            });
            await tx.inventoryMovement.create({
              data: {
                organizationId: orgId,
                productId: item.productId,
                userId: actor.userId,
                saleId: null,
                inventoryLoanEventId: event.id,
                type:
                  type === 'DELIVER'
                    ? MovementType.LOAN_DELIVERY
                    : MovementType.LOAN_RETURN,
                quantity: stockDelta,
                previousStock,
                newStock,
                reason:
                  type === 'DELIVER'
                    ? 'Entrega de préstamo de inventario'
                    : 'Devolución de préstamo de inventario',
              },
            });
            movementStocks.set(item.productId, newStock);
          }
          await tx.auditLog.create({
            data: {
              organizationId: orgId,
              userId: actor.userId,
              action:
                type === 'DELIVER'
                  ? 'INVENTORY_LOAN_DELIVERED'
                  : 'INVENTORY_LOAN_RETURNED',
              resource: 'InventoryLoan',
              resourceId: id,
              metadata: { operationId: operation.id },
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        const previous = await this.prisma.inventoryLoanOperation.findUnique({
          where: key,
        });
        if (previous) return replayResult(previous);
        throw new ConflictException(
          'Conflicto de inventario; reintente con la misma clave',
        );
      }
      throw error;
    }
  }

  private async validateCounterparty(
    tx: Prisma.TransactionClient,
    dto: CreateInventoryLoanDto,
    orgId: string,
  ) {
    const where = {
      id: dto.counterpartyId,
      organizationId: orgId,
      active: true,
    };
    const found =
      dto.counterpartyType === CounterpartyType.CUSTOMER
        ? await tx.customer.findFirst({ where, select: { id: true } })
        : dto.counterpartyType === CounterpartyType.SUPPLIER
          ? await tx.supplier.findFirst({ where, select: { id: true } })
          : await tx.organizationUser.findFirst({
              where: {
                userId: dto.counterpartyId,
                organizationId: orgId,
                user: { active: true },
              },
              select: { userId: true },
            });
    if (!found)
      throw new BadRequestException(
        'Contraparte activa de la organización requerida',
      );
  }

  async findAll(query: InventoryLoanQuery, organizationId: string | undefined) {
    const orgId = organization(organizationId);
    if (
      query.status !== undefined &&
      query.status !== InventoryLoanStatus.OPEN &&
      query.status !== InventoryLoanStatus.CANCELLED &&
      query.status !== InventoryLoanStatus.CLOSED
    ) {
      throw new BadRequestException('Estado de préstamo inválido');
    }
    if (
      (query.counterpartyType === undefined) !==
        (query.counterpartyId === undefined) ||
      (query.counterpartyType !== undefined &&
        (!Object.values(CounterpartyType).includes(query.counterpartyType) ||
          typeof query.counterpartyId !== 'string' ||
          !query.counterpartyId))
    ) {
      throw new BadRequestException('Filtro de contraparte inválido');
    }
    const where: Prisma.InventoryLoanWhereInput = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.counterpartyType === CounterpartyType.CUSTOMER
        ? { customerId: query.counterpartyId }
        : {}),
      ...(query.counterpartyType === CounterpartyType.SUPPLIER
        ? { supplierId: query.counterpartyId }
        : {}),
      ...(query.counterpartyType === CounterpartyType.EMPLOYEE
        ? { employeeId: query.counterpartyId }
        : {}),
    };
    const paging = page(query);
    const [rows, total] = await Promise.all([
      this.prisma.inventoryLoan.findMany({
        where,
        select: loanSelect(orgId),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.inventoryLoan.count({ where }),
    ]);
    return {
      data: rows.map(present),
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }

  async findOne(id: string, organizationId: string | undefined) {
    const orgId = organization(organizationId);
    const loan = await this.prisma.inventoryLoan.findFirst({
      where: { id, organizationId: orgId },
      select: loanSelect(orgId),
    });
    if (!loan) throw new NotFoundException('Préstamo no encontrado');
    return present(loan);
  }

  async history(
    id: string,
    query: InventoryLoanQuery,
    organizationId: string | undefined,
  ) {
    const orgId = organization(organizationId);
    await this.findOne(id, orgId);
    const where = { loanId: id, organizationId: orgId };
    const paging = page(query);
    const [data, total] = await Promise.all([
      this.prisma.inventoryLoanEvent.findMany({
        where,
        select: {
          id: true,
          loanId: true,
          itemId: true,
          type: true,
          quantity: true,
          createdById: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.limit,
      }),
      this.prisma.inventoryLoanEvent.count({ where }),
    ]);
    return {
      data,
      total,
      page: paging.page,
      limit: paging.limit,
      totalPages: Math.ceil(total / paging.limit),
    };
  }
}
