import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { resolveReceiptLogo } from '../../receipts/receipt-logo';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { toCalendarDay } from '../purchase-order-status';
import type { SendPurchaseOrderDto } from '../dto/send-purchase-order.dto';
import {
  buildPurchaseOrderDocumentData,
  buildPurchaseOrderSnapshot,
  readPurchaseOrderSnapshot,
} from './purchase-order-document';
import { renderPurchaseOrderPdf } from './purchase-order-pdf';

/** A draft is still being written and a cancelled order must not reach a supplier. */
const UNSENDABLE_STATUSES = new Set(['DRAFT', 'CANCELLED']);

const DOCUMENT_INCLUDE = {
  supplier: true,
  createdBy: { select: { name: true } },
  items: { include: { product: { select: { name: true, sku: true } } } },
} satisfies Prisma.PurchaseOrderInclude;

/**
 * Turns a confirmed purchase order into the document sent to its supplier.
 *
 * `send` records the first send (instant, channel, expected delivery day and
 * frozen snapshot) and is safe to repeat; `generatePdf` renders a sent order from
 * its snapshot and an unsent one from the current settings. Receiving and stock
 * are not touched here.
 */
@Injectable()
export class PurchaseOrderDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async send(
    id: string,
    organizationId: string | undefined,
    dto: SendPurchaseOrderDto = {},
  ) {
    const orgId = this.requireOrganization(organizationId);
    const order = await this.loadOrder(id, orgId);
    if (UNSENDABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(
        order.status === 'DRAFT'
          ? 'Confirmá la orden antes de enviarla'
          : 'Una orden cancelada no se puede enviar',
      );
    }

    if (!order.sentAt) {
      const settings = await this.settingsService.find(orgId);
      // Guarded by `sentAt: null`: when two first sends race, one snapshot wins
      // and the other leaves it untouched. A date sent with a re-send is dropped
      // here too: the document is already frozen, so its delivery day cannot
      // move (the PDF reads the stored date).
      await this.prisma.purchaseOrder.updateMany({
        where: { id, organizationId: orgId, sentAt: null },
        data: {
          sentAt: new Date(),
          sentVia: 'PDF',
          ...(dto.expectedDeliveryDate
            ? { expectedDeliveryDate: toCalendarDay(dto.expectedDeliveryDate) }
            : {}),
          documentSnapshot: buildPurchaseOrderSnapshot(
            order,
            settings,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return this.purchaseOrdersService.findOne(id, orgId);
  }

  async generatePdf(
    id: string,
    organizationId: string | undefined,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const orgId = this.requireOrganization(organizationId);
    const order = await this.loadOrder(id, orgId);
    if (order.status === 'DRAFT') {
      throw new BadRequestException(
        'Una orden en borrador todavía no tiene documento',
      );
    }

    const snapshot =
      readPurchaseOrderSnapshot(order.documentSnapshot) ??
      buildPurchaseOrderSnapshot(order, await this.settingsService.find(orgId));
    const data = buildPurchaseOrderDocumentData(order, snapshot);
    const logo = await resolveReceiptLogo(
      data.business.logoUrl,
      this.config?.get<string>('CLOUDINARY_CLOUD_NAME'),
      this.config?.get<string>('LOCAL_UPLOAD_PATH') || './uploads',
    );

    return {
      buffer: renderPurchaseOrderPdf(data, logo),
      filename: `orden_compra_${data.documentNumber}.pdf`,
    };
  }

  private requireOrganization(organizationId: string | undefined): string {
    if (!organizationId) {
      throw new BadRequestException(
        'Organization ID is required for this operation',
      );
    }
    return organizationId;
  }

  private async loadOrder(id: string, organizationId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: DOCUMENT_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    return order;
  }
}
