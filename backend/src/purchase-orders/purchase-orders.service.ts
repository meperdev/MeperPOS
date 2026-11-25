import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePurchaseOrderDto,
  CreatePurchaseOrderItemDto,
} from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { CancelPurchaseOrderDto } from './dto/cancel-purchase-order.dto';
import { QueryPurchaseOrdersDto } from './dto/query-purchase-orders.dto';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { DuplicatePurchaseOrderDto } from './dto/duplicate-purchase-order.dto';
import {
  OPEN_PURCHASE_ORDER_STATUSES,
  bogotaToday,
  isPurchaseOrderOverdue,
  toCalendarDay,
} from './purchase-order-status';
import { SequenceService } from '../common/sequences/sequence.service';
import { tracksStock } from '../products/product-type.logic';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { resolveWritableSiteWithin } from '../locations/authorized-site';
import {
  applySiteStockDelta,
  resolveDefaultSiteWithin,
} from '../inventory/site-stock';

interface ComputedItem {
  productId: string;
  qtyOrdered: number;
  unitCost: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
}

/** A line of a repeated order that cannot be ordered again. */
export interface SkippedDuplicateItem {
  productId: string;
  name: string;
  reason: 'INACTIVE' | 'NOT_STOCKED';
}

interface NormalizedReceiveItem {
  itemId: string;
  qtyReceivedNow: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private sequenceService: SequenceService,
  ) {}

  private normalizeOrderNumberQuery(query: string) {
    return query.replace(/^oc[-\s]*/i, '').trim();
  }

  private buildDateToExclusive(dateTo: string) {
    const exclusive = new Date(dateTo);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    return exclusive;
  }

  private normalizeReceiveItems(items: ReceivePurchaseOrderDto['items']) {
    const totalsByItemId = new Map<string, number>();

    for (const item of items) {
      if (totalsByItemId.has(item.itemId)) {
        throw new BadRequestException(
          `El ítem ${item.itemId} está repetido en la recepción`,
        );
      }

      totalsByItemId.set(item.itemId, item.qtyReceivedNow);
    }

    return Array.from(totalsByItemId.entries()).map(
      ([itemId, qtyReceivedNow]): NormalizedReceiveItem => ({
        itemId,
        qtyReceivedNow,
      }),
    );
  }

  /**
   * Claims this tenant's order row for the rest of the transaction, with the
   * same lock receiving uses. Draft edits and confirmation both write values a
   * competing request may invalidate, so the claim comes first and the values
   * they validate are read again after it: a request that read a draft can
   * neither write on top of a cancelled order nor modify a confirmed one.
   */
  private async claimOrderRow(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [claimed] = await tx.$queryRaw<
      { status: string; supplierId: string }[]
    >`
      SELECT "status", "supplierId" FROM "PurchaseOrder"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR NO KEY UPDATE
    `;
    if (!claimed) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    return claimed;
  }

  private async computeItems(
    items: CreatePurchaseOrderItemDto[],
    organizationId: string,
  ): Promise<{
    computed: ComputedItem[];
    subtotal: number;
    taxAmount: number;
    total: number;
  }> {
    const computed: ComputedItem[] = [];
    let subtotal = 0;
    let taxAmount = 0;

    for (const item of items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, organizationId },
      });
      if (!product) {
        throw new NotFoundException(
          `Producto con ID ${item.productId} no encontrado`,
        );
      }
      if (!product.active) {
        throw new BadRequestException(
          `El producto ${product.name} no está activo`,
        );
      }

      // A service is sold labour: it has no stock to receive and cannot be bought.
      // Refusing here means no order number is consumed and nothing is written.
      if (!tracksStock(product)) {
        throw new BadRequestException(
          `El ítem ${product.name} no maneja inventario y no puede formar parte de una orden de compra`,
        );
      }

      const taxRate = item.taxRate ?? Number(product.taxRate);
      const itemSubtotal = item.qtyOrdered * item.unitCost;
      const itemTax = itemSubtotal * (taxRate / 100);

      subtotal += itemSubtotal;
      taxAmount += itemTax;

      computed.push({
        productId: item.productId,
        qtyOrdered: item.qtyOrdered,
        unitCost: item.unitCost,
        taxRate,
        subtotal: itemSubtotal,
        taxAmount: itemTax,
      });
    }

    return {
      computed,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
    };
  }

  async create(
    dto: CreatePurchaseOrderDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId },
    });
    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado');
    }
    if (!supplier.active) {
      throw new BadRequestException('Proveedor inactivo');
    }

    const { computed, subtotal, taxAmount, total } = await this.computeItems(
      dto.items,
      organizationId,
    );

    const year = new Date().getFullYear();

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const { number: orderNumber } = await this.sequenceService.nextNumber(
            tx,
            organizationId,
            'PO',
            year,
          );

          const order = await tx.purchaseOrder.create({
            data: {
              organizationId,
              orderNumber,
              supplierId: dto.supplierId,
              createdById: userId,
              status: 'DRAFT',
              subtotal,
              taxAmount,
              total,
              notes: dto.notes,
            },
          });

          for (const c of computed) {
            await tx.purchaseOrderItem.create({
              data: {
                organizationId,
                purchaseOrderId: order.id,
                productId: c.productId,
                qtyOrdered: c.qtyOrdered,
                unitCost: c.unitCost,
                taxRate: c.taxRate,
                subtotal: c.subtotal,
                taxAmount: c.taxAmount,
              },
            });
          }

          return order;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );

      return this.findOne(created.id, organizationId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2028'
      ) {
        throw new ServiceUnavailableException('Intente nuevamente');
      }
      throw error;
    }
  }

  /**
   * "Repetir pedido": builds a new draft from any order through `create()`, so
   * the new order is validated, numbered and priced like any other. Each line
   * keeps its product and ordered quantity and takes the product's current
   * cost; the tax rate is left to `create()`, which uses the product's. Lines
   * whose product is inactive or does not track stock are left out and
   * reported.
   */
  async duplicate(
    id: string,
    dto: DuplicatePurchaseOrderDto,
    userId: string,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const source = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: { include: { product: true } } },
    });
    if (!source) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    const items: CreatePurchaseOrderItemDto[] = [];
    const skippedItems: SkippedDuplicateItem[] = [];
    for (const item of source.items) {
      const { product } = item;
      if (!product.active) {
        skippedItems.push({
          productId: product.id,
          name: product.name,
          reason: 'INACTIVE',
        });
      } else if (!tracksStock(product)) {
        skippedItems.push({
          productId: product.id,
          name: product.name,
          reason: 'NOT_STOCKED',
        });
      } else {
        items.push({
          productId: product.id,
          qtyOrdered: item.qtyOrdered,
          unitCost: Number(product.costPrice),
        });
      }
    }

    if (items.length === 0) {
      throw new BadRequestException(
        'Ningún producto de esta orden se puede volver a pedir',
      );
    }

    const order = await this.create(
      { supplierId: dto.supplierId ?? source.supplierId, items },
      userId,
      organizationId,
    );
    return { order, skippedItems };
  }

  async findAll(
    organizationId: string | undefined,
    query: QueryPurchaseOrdersDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      ...(organizationId ? { organizationId } : {}),
    };

    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status === 'OPEN') {
      where.status = { in: [...OPEN_PURCHASE_ORDER_STATUSES] };
    } else if (query.status === 'OVERDUE') {
      where.status = { in: [...OPEN_PURCHASE_ORDER_STATUSES] };
      where.expectedDeliveryDate = { lt: bogotaToday() };
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        createdAt.lt = this.buildDateToExclusive(query.dateTo);
      }
      where.createdAt = createdAt;
    }

    const q = query.q?.trim();
    if (q) {
      const orFilters: Record<string, unknown>[] = [
        {
          supplier: {
            is: { name: { contains: q, mode: 'insensitive' } },
          },
        },
        { notes: { contains: q, mode: 'insensitive' } },
      ];

      const normalizedOrderQuery = this.normalizeOrderNumberQuery(q);
      if (/^\d+$/.test(normalizedOrderQuery)) {
        const orderNumber = Number.parseInt(normalizedOrderQuery, 10);
        orFilters.push({ orderNumber });
      }

      where.OR = orFilters;
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: where as never,
        skip,
        take: limit,
        include: {
          supplier: true,
          createdBy: { select: { id: true, name: true, email: true } },
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where: where as never }),
    ]);

    const today = bogotaToday();
    return {
      data: data.map((order) => this.withDerivedFields(order, today)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, organizationId: string | undefined) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: {
        supplier: true,
        createdBy: { select: { id: true, name: true, email: true } },
        items: { include: { product: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    return this.withDerivedFields(order);
  }

  /** Server-owned fields every read returns, so the list and the detail agree. */
  private withDerivedFields<
    T extends { status: string; expectedDeliveryDate?: Date | null },
  >(order: T, today: Date = bogotaToday()): T & { overdue: boolean } {
    return { ...order, overdue: isPurchaseOrderOverdue(order, today) };
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Solo se pueden editar órdenes en borrador',
      );
    }

    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, organizationId },
      });
      if (!supplier) {
        throw new NotFoundException('Proveedor no encontrado');
      }
      if (!supplier.active) {
        throw new BadRequestException('Proveedor inactivo');
      }
    }

    const computed = dto.items
      ? await this.computeItems(dto.items, organizationId)
      : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await this.claimOrderRow(tx, id, organizationId);
      if (claimed.status !== 'DRAFT') {
        throw new BadRequestException(
          'Solo se pueden editar órdenes en borrador',
        );
      }

      // The draft may have changed while this request waited for the claim, so
      // the supplier it keeps is the one stored now, not the one it read.
      const currentSupplierId = dto.supplierId ?? claimed.supplierId;

      if (computed) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id, organizationId },
        });
        for (const c of computed.computed) {
          await tx.purchaseOrderItem.create({
            data: {
              organizationId,
              purchaseOrderId: id,
              productId: c.productId,
              qtyOrdered: c.qtyOrdered,
              unitCost: c.unitCost,
              taxRate: c.taxRate,
              subtotal: c.subtotal,
              taxAmount: c.taxAmount,
            },
          });
        }
        await tx.purchaseOrder.update({
          where: { id, organizationId },
          data: {
            supplierId: currentSupplierId,
            notes: dto.notes,
            subtotal: computed.subtotal,
            taxAmount: computed.taxAmount,
            total: computed.total,
          },
        });
      } else {
        await tx.purchaseOrder.update({
          where: { id, organizationId },
          data: {
            supplierId: currentSupplierId,
            notes: dto.notes,
          },
        });
      }
    });

    return this.findOne(id, organizationId);
  }

  async confirm(
    id: string,
    organizationId: string | undefined,
    dto: ConfirmPurchaseOrderDto = {},
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: true, supplier: true },
    });
    if (!order) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    if (order.status !== 'DRAFT') {
      throw new BadRequestException(
        'Solo se pueden confirmar órdenes en borrador',
      );
    }
    if (order.items.length === 0) {
      throw new BadRequestException(
        'La orden debe tener al menos un ítem para confirmarse',
      );
    }
    if (!order.supplier.active) {
      throw new BadRequestException('Proveedor inactivo');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await this.claimOrderRow(tx, id, organizationId);
      if (claimed.status !== 'DRAFT') {
        throw new BadRequestException(
          'Solo se pueden confirmar órdenes en borrador',
        );
      }

      // Confirming freezes the order as it is stored now: a concurrent edit may
      // have replaced its items or its supplier since this request read it.
      const live = await tx.purchaseOrder.findFirst({
        where: { id, organizationId },
        include: { items: true, supplier: true },
      });
      if (!live) {
        throw new NotFoundException('Orden de compra no encontrada');
      }
      if (live.items.length === 0) {
        throw new BadRequestException(
          'La orden debe tener al menos un ítem para confirmarse',
        );
      }
      if (!live.supplier.active) {
        throw new BadRequestException('Proveedor inactivo');
      }

      await tx.purchaseOrder.update({
        where: { id, organizationId },
        data: {
          status: 'PENDING',
          confirmedAt: new Date(),
          ...(dto.expectedDeliveryDate
            ? { expectedDeliveryDate: toCalendarDay(dto.expectedDeliveryDate) }
            : {}),
        },
      });
    });

    return this.findOne(id, organizationId);
  }

  async receive(
    id: string,
    dto: ReceivePurchaseOrderDto,
    userId: string,
    organizationId: string | undefined,
    actor?: RequestUser,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    if (order.status !== 'PENDING' && order.status !== 'PARTIAL_RECEIVED') {
      throw new BadRequestException(
        'Solo se pueden recibir órdenes pendientes o parcialmente recibidas',
      );
    }

    const normalizedItems = this.normalizeReceiveItems(dto.items);
    const itemsById = new Map(order.items.map((i) => [i.id, i]));

    for (const r of normalizedItems) {
      const item = itemsById.get(r.itemId);
      if (!item) {
        throw new NotFoundException(`Ítem ${r.itemId} no pertenece a la orden`);
      }
      const pending = item.qtyOrdered - item.qtyReceived;
      if (r.qtyReceivedNow > pending) {
        throw new BadRequestException(
          `Cantidad recibida excede lo pendiente para el ítem ${r.itemId}`,
        );
      }
    }

    const { locationId } = dto;
    const receiveItems = async (tx: Prisma.TransactionClient) => {
      // The whole batch lands at one site. The explicit destination keeps the
      // existing authorization and sole-principal gate; a legacy request with no
      // destination lands at the organization default site, so every receipt has
      // a site balance from now on.
      let destinationId: string;
      if (locationId !== undefined) {
        if (
          actor?.userId !== userId ||
          actor.organizationId !== organizationId
        ) {
          throw new ForbiddenException('Organization scope required');
        }
        const destination = await resolveWritableSiteWithin(
          tx,
          actor,
          locationId,
        );
        const sites = await tx.location.findMany({
          where: { organizationId },
          select: { id: true, isDefault: true },
          take: 2,
        });
        if (
          sites.length !== 1 ||
          !sites[0].isDefault ||
          sites[0].id !== destination.locationId
        ) {
          throw new ConflictException(
            'El stock global solo permite recibir compras en la única sede principal',
          );
        }
        destinationId = destination.locationId;
      } else {
        destinationId = await resolveDefaultSiteWithin(tx, organizationId);
      }

      // Lock the order before reading receipt quantities or changing inventory.
      // A quantity-only check (or the per-product CAS) cannot serialize two
      // receipts on different lines, or a receipt against cancellation.
      const [lockedOrder] = await tx.$queryRaw<
        { status: typeof order.status }[]
      >`
        SELECT "status" FROM "PurchaseOrder"
        WHERE "id" = ${id} AND "organizationId" = ${organizationId}
        FOR NO KEY UPDATE
      `;
      if (!lockedOrder) {
        throw new NotFoundException('Orden de compra no encontrada');
      }
      if (
        lockedOrder.status !== 'PENDING' &&
        lockedOrder.status !== 'PARTIAL_RECEIVED'
      ) {
        throw new BadRequestException(
          'Solo se pueden recibir órdenes pendientes o parcialmente recibidas',
        );
      }

      for (const r of normalizedItems) {
        const item = await tx.purchaseOrderItem.findUnique({
          where: { id: r.itemId },
        });

        if (!item || item.purchaseOrderId !== id) {
          throw new NotFoundException(
            `Ítem ${r.itemId} no pertenece a la orden`,
          );
        }

        const pending = item.qtyOrdered - item.qtyReceived;
        if (r.qtyReceivedNow > pending) {
          throw new BadRequestException(
            `Cantidad recibida excede lo pendiente para el ítem ${r.itemId}`,
          );
        }

        const product = await tx.product.findFirst({
          where: { id: item.productId, organizationId },
        });
        if (!product) {
          throw new NotFoundException(
            `Producto ${item.productId} no encontrado`,
          );
        }

        // Defence in depth: a service line can only exist in an order drafted before
        // the validation above existed. Receiving one must not invent merchandise.
        if (tracksStock(product)) {
          // previousStock/newStock keep documenting the organization-wide balance
          // the kárdex has always recorded; the site is now the attribution and
          // the ledger that actually moves.
          const previousStock = product.stock;
          const newStock = previousStock + r.qtyReceivedNow;
          const currentVersion = product.version;
          const newUnitCost = Number(item.unitCost);
          const oldCost = Number(product.costPrice);
          const costChanged = newUnitCost !== oldCost;

          // The version guard is the optimistic-concurrency contract of product
          // edits and stays exactly as it was; the stock itself now moves through
          // the site row, whose trigger keeps the organization aggregate equal to
          // the sum of its sites.
          const updateData: Record<string, unknown> = {
            version: { increment: 1 },
          };
          if (costChanged) {
            updateData.costPrice = newUnitCost;
          }

          const updated = await tx.product.updateMany({
            where: { id: item.productId, version: currentVersion },
            data: updateData,
          });

          if (updated.count === 0) {
            throw new ConflictException(
              'Modificación concurrente detectada sobre el producto',
            );
          }

          const receipt = await applySiteStockDelta(tx, {
            organizationId,
            productId: item.productId,
            locationId: destinationId,
            stockDelta: r.qtyReceivedNow,
            reservedDelta: 0,
          });
          if (!receipt.applied) {
            // A receipt always raises availability, so this is the same product
            // race the aggregate compare-and-swap used to report.
            throw new ConflictException(
              'Modificación concurrente detectada sobre el producto',
            );
          }

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              type: 'PURCHASE',
              quantity: r.qtyReceivedNow,
              previousStock,
              newStock,
              reason: `OC-${order.orderNumber}`,
              userId,
              organizationId,
              locationId: destinationId,
            },
          });

          if (costChanged) {
            await tx.auditLog.create({
              data: {
                userId,
                action: 'PRODUCT_COST_UPDATED_FROM_PO',
                resource: 'Product',
                resourceId: item.productId,
                organizationId,
                metadata: {
                  oldCost,
                  newCost: newUnitCost,
                  orderNumber: order.orderNumber,
                  purchaseOrderId: order.id,
                },
              },
            });
          }
        }

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { qtyReceived: { increment: r.qtyReceivedNow } },
        });
      }

      const refreshed = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
      });
      const allReceived = refreshed.every((i) => i.qtyReceived >= i.qtyOrdered);

      await tx.purchaseOrder.update({
        where: { id, organizationId },
        data: allReceived
          ? { status: 'RECEIVED', receivedAt: new Date() }
          : { status: 'PARTIAL_RECEIVED' },
      });
    };
    if (locationId === undefined) {
      await this.prisma.$transaction(receiveItems);
    } else {
      try {
        await this.prisma.$transaction(receiveItems, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' ||
            (error.code === 'P2010' &&
              (error.meta?.code === '40001' || error.meta?.code === '40P01')))
        ) {
          throw new ConflictException(
            'Recepción concurrente; revise la orden y vuelva a intentar',
          );
        }
        throw error;
      }
    }

    return this.findOne(id, organizationId);
  }

  async cancel(
    id: string,
    dto: CancelPurchaseOrderDto,
    organizationId: string | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
    });
    if (!order) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    if (order.status !== 'DRAFT' && order.status !== 'PENDING') {
      throw new BadRequestException(
        'Solo se pueden cancelar órdenes en borrador o pendientes',
      );
    }

    const cancelled = await this.prisma.purchaseOrder.updateMany({
      where: { id, organizationId, status: { in: ['DRAFT', 'PENDING'] } },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: dto.reason,
      },
    });
    if (cancelled.count === 0) {
      throw new BadRequestException(
        'Solo se pueden cancelar órdenes en borrador o pendientes',
      );
    }

    return this.findOne(id, organizationId);
  }
}
