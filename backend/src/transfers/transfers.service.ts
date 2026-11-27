import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementType,
  OrgRole,
  Prisma,
  StockTransferStatus,
} from '@prisma/client';
import { SequenceService } from '../common/sequences/sequence.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { applySiteStockDelta } from '../inventory/site-stock';
import { resolveWritableSiteWithin } from '../locations/authorized-site';
import { tracksStock } from '../products/product-type.logic';
import { PrismaService } from '../prisma/prisma.service';
import type { CancelStockTransferDto } from './dto/cancel-stock-transfer.dto';
import type { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import type { QueryStockTransfersDto } from './dto/query-stock-transfers.dto';
import { hasEffectiveRole } from '../common/guards/role-hierarchy';

const SAME_SITE = 'La sede de origen y la de destino deben ser diferentes';
const DESTINATION_NOT_FOUND = 'Sede de destino no encontrada';
const TRANSFER_NOT_FOUND = 'Transferencia no encontrada';
const NOT_TRACKED =
  'Solo se pueden transferir productos que manejan inventario';
const NOT_RECEIVABLE = 'Solo se pueden recibir transferencias en tránsito';
const NOT_CANCELLABLE = 'Solo se pueden cancelar transferencias en tránsito';
const CONCURRENT =
  'La operación compitió con otra transferencia; vuelva a intentarlo';
const LINE_LOST = 'Modificación concurrente detectada sobre el producto';

const siteFields = {
  id: true,
  name: true,
  type: true,
} as const;

const productFields = {
  id: true,
  name: true,
  sku: true,
} as const;

/** The document shape every endpoint returns, with its sites and lines named. */
const transferInclude = {
  fromLocation: { select: siteFields },
  toLocation: { select: siteFields },
  createdBy: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  items: {
    include: { product: { select: productFields } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StockTransferInclude;

/** PostgreSQL codes that mean another transaction won the same race. */
const SERIALIZATION_PG_CODES = ['40001', '40P01'];

/**
 * `SELECT ... FOR NO KEY UPDATE` runs through `$queryRaw`, so Prisma reports a
 * PostgreSQL serialization failure or deadlock as `P2010` with the database code
 * in `meta`. Both shapes become the same conflict; nothing is retried on the
 * caller's behalf.
 */
function isConcurrentTransferConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (['P2002', 'P2003', 'P2034'].includes(error.code)) return true;
  if (error.code !== 'P2010') return false;
  const databaseCode = (error.meta as { code?: unknown } | undefined)?.code;
  if (
    typeof databaseCode === 'string' &&
    SERIALIZATION_PG_CODES.includes(databaseCode)
  ) {
    return true;
  }
  return SERIALIZATION_PG_CODES.some((code) =>
    error.message.includes(`Code: \`${code}\``),
  );
}

interface ClaimedTransfer {
  id: string;
  status: StockTransferStatus;
  number: number;
  fromLocationId: string;
  toLocationId: string;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Dispatches tracked stock from an authorized source site to another site of
   * the same tenant. The stock leaves the source site row (and therefore the
   * organization aggregate) and stays in transit until it is received.
   */
  async dispatch(user: RequestUser, dto: CreateStockTransferDto) {
    const organizationId = this.requireOrganization(user);
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException(SAME_SITE);
    }
    const items = this.normalizeItems(dto.items);

    return this.inSerializable(async (tx) => {
      const source = await resolveWritableSiteWithin(
        tx,
        user,
        dto.fromLocationId,
      );
      const destination = await tx.location.findFirst({
        where: { id: dto.toLocationId, organizationId },
        select: { id: true },
      });
      // A site of another tenant is indistinguishable from a missing one.
      if (!destination) throw new NotFoundException(DESTINATION_NOT_FOUND);

      // Read every line before moving any stock, so an unknown or untracked
      // product is answered without a partial effect.
      const previousStock = new Map<string, number>();
      for (const item of items) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, organizationId },
        });
        if (!product) {
          throw new NotFoundException(
            `Producto ${item.productId} no encontrado`,
          );
        }
        if (!tracksStock(product)) {
          throw new BadRequestException(NOT_TRACKED);
        }
        previousStock.set(item.productId, product.stock);
      }

      const { number } = await this.sequence.nextNumber(
        tx,
        organizationId,
        'TRANSFER',
      );

      const transfer = await tx.stockTransfer.create({
        data: {
          number,
          organizationId,
          fromLocationId: source.locationId,
          toLocationId: destination.id,
          notes: dto.notes && dto.notes.length > 0 ? dto.notes : null,
          createdById: user.userId,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
        },
        select: { id: true },
      });

      for (const item of items) {
        const before = previousStock.get(item.productId)!;
        const applied = await applySiteStockDelta(tx, {
          organizationId,
          productId: item.productId,
          locationId: source.locationId,
          stockDelta: -item.quantity,
          reservedDelta: 0,
        });
        if (!applied.applied) {
          throw new ConflictException(
            `Existencias insuficientes en la sede de origen para el producto ${item.productId}`,
          );
        }
        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            type: MovementType.TRANSFER_OUT,
            quantity: -item.quantity,
            previousStock: before,
            newStock: before - item.quantity,
            reason: this.reference(number),
            userId: user.userId,
            organizationId,
            locationId: source.locationId,
          },
        });
      }

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id_organizationId: { id: transfer.id, organizationId } },
        include: transferInclude,
      });
    });
  }

  /** Lands an in-transit transfer at its destination, authorized there. */
  async receive(user: RequestUser, id: string) {
    const organizationId = this.requireOrganization(user);

    return this.inSerializable(async (tx) => {
      const transfer = await this.claim(tx, id, organizationId);
      if (transfer.status !== StockTransferStatus.IN_TRANSIT) {
        throw new ConflictException(NOT_RECEIVABLE);
      }
      const destination = await resolveWritableSiteWithin(
        tx,
        user,
        transfer.toLocationId,
      );

      await this.applyInboundLines(tx, {
        organizationId,
        transfer,
        locationId: destination.locationId,
        userId: user.userId,
      });

      await tx.stockTransfer.update({
        where: { id_organizationId: { id, organizationId } },
        data: {
          status: StockTransferStatus.RECEIVED,
          receivedAt: new Date(),
          receivedById: user.userId,
        },
      });

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id_organizationId: { id, organizationId } },
        include: transferInclude,
      });
    });
  }

  /** Returns an in-transit transfer to its origin, authorized there. */
  async cancel(user: RequestUser, id: string, dto: CancelStockTransferDto) {
    const organizationId = this.requireOrganization(user);

    return this.inSerializable(async (tx) => {
      const transfer = await this.claim(tx, id, organizationId);
      if (transfer.status !== StockTransferStatus.IN_TRANSIT) {
        throw new ConflictException(NOT_CANCELLABLE);
      }
      const origin = await resolveWritableSiteWithin(
        tx,
        user,
        transfer.fromLocationId,
      );

      await this.applyInboundLines(tx, {
        organizationId,
        transfer,
        locationId: origin.locationId,
        userId: user.userId,
      });

      await tx.stockTransfer.update({
        where: { id_organizationId: { id, organizationId } },
        data: {
          status: StockTransferStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: user.userId,
          cancelReason: dto.reason,
        },
      });

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id_organizationId: { id, organizationId } },
        include: transferInclude,
      });
    });
  }

  async findAll(user: RequestUser, query: QueryStockTransfersDto) {
    const organizationId = this.requireOrganization(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const visibleSites = await this.visibleSiteIds(user);

    const where: Prisma.StockTransferWhereInput = { organizationId };
    if (query.status) where.status = query.status;

    const and: Prisma.StockTransferWhereInput[] = [];
    if (query.siteId) {
      and.push({
        OR: [{ fromLocationId: query.siteId }, { toLocationId: query.siteId }],
      });
    }
    if (visibleSites) {
      // A restricted membership only reads documents that touch a site it was
      // assigned: zero assignments means zero transfers, never all of them.
      and.push({
        OR: [
          { fromLocationId: { in: visibleSites } },
          { toLocationId: { in: visibleSites } },
        ],
      });
    }
    if (and.length > 0) where.AND = and;

    const [data, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        include: transferInclude,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(user: RequestUser, id: string) {
    const organizationId = this.requireOrganization(user);
    const visibleSites = await this.visibleSiteIds(user);

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: {
        id,
        organizationId,
        ...(visibleSites
          ? {
              OR: [
                { fromLocationId: { in: visibleSites } },
                { toLocationId: { in: visibleSites } },
              ],
            }
          : {}),
      },
      include: transferInclude,
    });
    if (!transfer) throw new NotFoundException(TRANSFER_NOT_FOUND);
    return transfer;
  }

  private requireOrganization(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException('Organization scope required');
    }
    return user.organizationId;
  }

  /** `null` means organization-wide access; an array is the exact allowed set. */
  private async visibleSiteIds(user: RequestUser): Promise<string[] | null> {
    const organizationId = this.requireOrganization(user);
    if (user.isSuperAdmin || hasEffectiveRole(user.role, OrgRole.ADMIN)) {
      return null;
    }
    const rows = await this.prisma.membershipLocation.findMany({
      where: { userId: user.userId, organizationId },
      select: { locationId: true },
    });
    return rows.map((row) => row.locationId);
  }

  /** Rejects a repeated product, whose stock effect would be ambiguous. */
  private normalizeItems(
    items: CreateStockTransferDto['items'],
  ): Array<{ productId: string; quantity: number }> {
    const seen = new Set<string>();
    return items.map((item) => {
      if (seen.has(item.productId)) {
        throw new BadRequestException(
          `El producto ${item.productId} está repetido en la transferencia`,
        );
      }
      seen.add(item.productId);
      return { productId: item.productId, quantity: item.quantity };
    });
  }

  /**
   * Claims the tenant's transfer row for the rest of the transaction. A receipt
   * and a cancellation both decide the document's fate from its live status, so
   * a concurrent loser waits and then sees the committed outcome.
   */
  private async claim(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ): Promise<ClaimedTransfer> {
    const [claim] = await tx.$queryRaw<ClaimedTransfer[]>`
      SELECT "id", "status", "number", "fromLocationId", "toLocationId"
      FROM "StockTransfer"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR NO KEY UPDATE
    `;
    if (!claim) throw new NotFoundException(TRANSFER_NOT_FOUND);
    return claim;
  }

  /**
   * Puts every line's stock back onto one site. Both the receipt and the
   * cancellation add stock, so the site movement is an inbound one; the
   * document's own status is what says which leg it was.
   */
  private async applyInboundLines(
    tx: Prisma.TransactionClient,
    options: {
      organizationId: string;
      transfer: ClaimedTransfer;
      locationId: string;
      userId: string;
    },
  ) {
    const { organizationId, transfer, locationId, userId } = options;
    const items = await tx.stockTransferItem.findMany({
      where: { transferId: transfer.id, organizationId },
      orderBy: { id: 'asc' },
    });

    for (const item of items) {
      const product = await tx.product.findFirst({
        where: { id: item.productId, organizationId },
        select: { stock: true },
      });
      if (!product) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado`);
      }

      const applied = await applySiteStockDelta(tx, {
        organizationId,
        productId: item.productId,
        locationId,
        stockDelta: item.quantity,
        reservedDelta: 0,
      });
      if (!applied.applied) {
        // This leg only adds stock, so a refusal means the product row moved
        // away underneath a transfer that still references it.
        throw new ConflictException(LINE_LOST);
      }

      await tx.inventoryMovement.create({
        data: {
          productId: item.productId,
          type: MovementType.TRANSFER_IN,
          quantity: item.quantity,
          previousStock: product.stock,
          newStock: product.stock + item.quantity,
          reason: this.reference(transfer.number),
          userId,
          organizationId,
          locationId,
        },
      });
    }
  }

  private reference(number: number): string {
    return `TR-${number}`;
  }

  /**
   * Runs the writer in Serializable and turns a lost write race into the
   * established 409 instead of a raw serialization failure.
   */
  private async inSerializable<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isConcurrentTransferConflict(error)) {
        throw new ConflictException(CONCURRENT);
      }
      throw error;
    }
  }
}
