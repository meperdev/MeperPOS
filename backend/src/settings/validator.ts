import { DEFAULT_INVOICING, DEFAULT_PURCHASE_ORDER_TEMPLATE } from './defaults';
import {
  PURCHASE_ORDER_TEMPLATE_FIELDS,
  type InvoicingSettings,
  type PurchaseOrderTemplateSettings,
} from './schema';

/**
 * Runtime validation for typed core params.
 *
 * Invalid values fall back to the registry default and NEVER throw — reads
 * must be resilient to whatever was persisted in the JSON blob historically.
 */
export function validateInvoicing(
  raw: Record<string, unknown>,
): InvoicingSettings {
  return {
    printHeader:
      typeof raw.printHeader === 'string'
        ? raw.printHeader
        : DEFAULT_INVOICING.printHeader,
    printFooter:
      typeof raw.printFooter === 'string'
        ? raw.printFooter
        : DEFAULT_INVOICING.printFooter,
  };
}

/** Reads `purchaseOrderTemplate`, field by field, falling back to empty text. */
export function validatePurchaseOrderTemplate(
  raw: Record<string, unknown>,
): PurchaseOrderTemplateSettings {
  const stored = raw.purchaseOrderTemplate;
  const source =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const template = { ...DEFAULT_PURCHASE_ORDER_TEMPLATE };
  for (const field of PURCHASE_ORDER_TEMPLATE_FIELDS) {
    const value = source[field];
    if (typeof value === 'string') template[field] = value;
  }
  return template;
}
