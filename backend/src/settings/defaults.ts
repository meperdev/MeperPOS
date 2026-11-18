import {
  CURRENCY,
  LOCALE,
  TIMEZONE,
} from '../common/constants/locale.constants';
import type {
  InvoicingSettings,
  LocaleSettings,
  PurchaseOrderTemplateSettings,
} from './schema';

/**
 * Single defaults registry for the typed settings engine.
 *
 * Invalid persisted values fall back to these defaults on read (see validator).
 * Currency/locale/timezone are centralized constants, not per-org settings.
 */
export const DEFAULT_INVOICING: InvoicingSettings = {
  printHeader: '',
  printFooter: '',
};

export const DEFAULT_LOCALE: LocaleSettings = {
  currency: CURRENCY,
  locale: LOCALE,
  timezone: TIMEZONE,
};

export const DEFAULT_PURCHASE_ORDER_TEMPLATE: PurchaseOrderTemplateSettings = {
  deliveryAddress: '',
  paymentTerms: '',
  terms: '',
  footer: '',
};
