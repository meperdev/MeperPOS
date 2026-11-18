/**
 * Purchase order document contract.
 *
 * A purchase order becomes a document the business sends to its supplier. At
 * the first send the business, supplier, template, preparer and item names are
 * frozen into `PurchaseOrder.documentSnapshot`, so every later download is the
 * document the supplier received. Quantities and amounts always come from the
 * stored order (they are immutable once confirmed); nothing here derives money.
 */

import type { PurchaseOrderTemplateSettings } from '../../settings/schema';

export const PURCHASE_ORDER_SNAPSHOT_VERSION = 1;

export interface PurchaseOrderDocumentBusiness {
  name: string;
  taxId: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
}

export interface PurchaseOrderDocumentSupplier {
  name: string;
  documentNumber: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface PurchaseOrderDocumentSnapshot {
  version: typeof PURCHASE_ORDER_SNAPSHOT_VERSION;
  business: PurchaseOrderDocumentBusiness;
  supplier: PurchaseOrderDocumentSupplier;
  /** The template with the delivery address already resolved. */
  template: PurchaseOrderTemplateSettings;
  preparedBy: string | null;
  /** Product name and SKU per order item id, as they were at the first send. */
  items: Record<string, { name: string; sku: string | null }>;
}

/** Structural input: the order read with supplier, creator and item products. */
export interface PurchaseOrderDocumentOrder {
  orderNumber: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  expectedDeliveryDate: Date | null;
  cancelledAt: Date | null;
  subtotal: unknown;
  taxAmount: unknown;
  total: unknown;
  supplier: {
    name: string;
    documentNumber: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  createdBy?: { name: string } | null;
  items: Array<{
    id: string;
    qtyOrdered: number;
    unitCost: unknown;
    taxRate: unknown;
    subtotal: unknown;
    product: { name: string; sku?: string | null } | null;
  }>;
}

/** Structural input: the slice of `SettingsView` the document reads. */
export interface PurchaseOrderDocumentSettings {
  organization: {
    name: string;
    logoUrl: string | null;
    taxId: string | null;
    phone: string | null;
    address: string | null;
  };
  purchaseOrder: PurchaseOrderTemplateSettings;
}

export interface PurchaseOrderDocumentItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number;
  taxRate: number;
  subtotal: number;
}

export interface PurchaseOrderDocumentData {
  documentNumber: string;
  status: string;
  issuedAt: Date;
  expectedDeliveryDate: Date | null;
  cancelledAt: Date | null;
  business: PurchaseOrderDocumentBusiness;
  supplier: PurchaseOrderDocumentSupplier;
  template: PurchaseOrderTemplateSettings;
  preparedBy: string | null;
  notes: string | null;
  items: PurchaseOrderDocumentItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
}

const DELETED_PRODUCT = 'Producto eliminado';

export function buildPurchaseOrderSnapshot(
  order: PurchaseOrderDocumentOrder,
  settings: PurchaseOrderDocumentSettings,
): PurchaseOrderDocumentSnapshot {
  const business = settings.organization;
  const template = settings.purchaseOrder;
  return {
    version: PURCHASE_ORDER_SNAPSHOT_VERSION,
    business: {
      name: business.name,
      taxId: business.taxId ?? null,
      phone: business.phone ?? null,
      address: business.address ?? null,
      logoUrl: business.logoUrl ?? null,
    },
    supplier: {
      name: order.supplier.name,
      documentNumber: order.supplier.documentNumber,
      contactName: order.supplier.contactName ?? null,
      phone: order.supplier.phone ?? null,
      email: order.supplier.email ?? null,
      address: order.supplier.address ?? null,
    },
    template: {
      deliveryAddress:
        template.deliveryAddress.trim() || business.address?.trim() || '',
      paymentTerms: template.paymentTerms,
      terms: template.terms,
      footer: template.footer,
    },
    preparedBy: order.createdBy?.name ?? null,
    items: Object.fromEntries(
      order.items.map((item) => [
        item.id,
        {
          name: item.product?.name ?? DELETED_PRODUCT,
          sku: item.product?.sku ?? null,
        },
      ]),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the stored snapshot when it has the expected shape, else `null`. */
export function readPurchaseOrderSnapshot(
  value: unknown,
): PurchaseOrderDocumentSnapshot | null {
  if (!isRecord(value) || value.version !== PURCHASE_ORDER_SNAPSHOT_VERSION) {
    return null;
  }
  const { business, supplier, template, items } = value;
  if (
    !isRecord(business) ||
    !isRecord(supplier) ||
    !isRecord(template) ||
    !isRecord(items)
  ) {
    return null;
  }
  return value as unknown as PurchaseOrderDocumentSnapshot;
}

export function buildPurchaseOrderDocumentData(
  order: PurchaseOrderDocumentOrder,
  snapshot: PurchaseOrderDocumentSnapshot,
): PurchaseOrderDocumentData {
  return {
    documentNumber: `OC-${order.orderNumber}`,
    status: order.status,
    issuedAt: order.confirmedAt ?? order.createdAt,
    expectedDeliveryDate: order.expectedDeliveryDate,
    cancelledAt: order.cancelledAt,
    business: snapshot.business,
    supplier: snapshot.supplier,
    template: snapshot.template,
    preparedBy: snapshot.preparedBy,
    notes: order.notes?.trim() || null,
    items: order.items.map((item) => {
      const frozen = snapshot.items[item.id];
      return {
        name: frozen?.name ?? item.product?.name ?? DELETED_PRODUCT,
        sku: frozen ? frozen.sku : (item.product?.sku ?? null),
        quantity: item.qtyOrdered,
        unitCost: Number(item.unitCost),
        taxRate: Number(item.taxRate),
        subtotal: Number(item.subtotal),
      };
    }),
    subtotal: Number(order.subtotal),
    taxAmount: Number(order.taxAmount),
    total: Number(order.total),
  };
}
