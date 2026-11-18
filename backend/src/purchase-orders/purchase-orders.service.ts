import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import {
  OPEN_PURCHASE_ORDER_STATUSES,
  bogotaToday,
  isPurchaseOrderOverdue,
  toCalendarDay,
} from './purchase-order-status';
import { SequenceService } from '../common/sequences/sequence.service';
import { tracksStock } from '../products/product-type.logic';

interface ComputedItem {
  productId: string;
  qtyOrdered: number;
  unitCost: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
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

    const supplierId = dto.supplierId ?? existing.supplierId;

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

    if (dto.items) {
      const { computed, subtotal, taxAmount, total } = await this.computeItems(
        dto.items,
        organizationId,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id, organizationId },
        });
        for (const c of computed) {
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
            supplierId,
            notes: dto.notes,
            subtotal,
            taxAmount,
            total,
          },
        });
      });
    } else {
      await this.prisma.purchaseOrder.update({
        where: { id },
        data: {
          supplierId,
          notes: dto.notes,
        },
      });
    }

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

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'PENDING',
        confirmedAt: new Date(),
        ...(dto.expectedDeliveryDate
          ? { expectedDeliveryDate: toCalendarDay(dto.expectedDeliveryDate) }
          : {}),
      },
    });

    return this.findOne(id, organizationId);
  }

  async receive(
    id: string,
    dto: ReceivePurchaseOrderDto,
    userId: string,
    organizationId: string | undefined,
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

    await this.prisma.$transaction(async (tx) => {
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
          const previousStock = product.stock;
          const newStock = previousStock + r.qtyReceivedNow;
          const currentVersion = product.version;
          const newUnitCost = Number(item.unitCost);
          const oldCost = Number(product.costPrice);
          const costChanged = newUnitCost !== oldCost;

          const updateData: Record<string, unknown> = {
            stock: { increment: r.qtyReceivedNow },
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
        where: { id },
        data: allReceived
          ? { status: 'RECEIVED', receivedAt: new Date() }
          : { status: 'PARTIAL_RECEIVED' },
      });
    });

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

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: dto.reason,
      },
    });

    return this.findOne(id, organizationId);
  }
}
