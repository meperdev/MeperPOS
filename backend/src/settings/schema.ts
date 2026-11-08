/**
 * Typed settings engine schema.
 *
 * The `Organization.settings` JSON blob is described by two kinds of keys:
 *
 * - **Core params** (`printHeader`, `printFooter`): typed, code-defined, runtime
 *   validated, editable by users.
 * - **System keys** (`downgradeFlags`, `electronicInvoicing`): managed by the
 *   backend, never writable through the user settings PUT.
 *
 * Anything else persisted in the blob is surfaced/preserved under `custom`.
 */

/** System-managed keys that user writes must never touch. */
export const SYSTEM_KEYS = ['downgradeFlags', 'electronicInvoicing'] as const;

/** Typed core params that live at the root of the settings JSON blob. */
export const CORE_KEYS = ['printHeader', 'printFooter'] as const;

export type SystemKey = (typeof SYSTEM_KEYS)[number];
export type CoreKey = (typeof CORE_KEYS)[number];

export const SYSTEM_KEY_SET: ReadonlySet<string> = new Set(SYSTEM_KEYS);
export const CORE_KEY_SET: ReadonlySet<string> = new Set(CORE_KEYS);

/**
 * Spec S9 — «solo para quienes la tienen activa».
 *
 * The pilot activation decision lives beside the other backend-managed system
 * keys instead of in its own column: no organization is invoiced unless this
 * flag is explicitly switched on for it, and the user settings PUT can neither
 * read nor write it. The shape is `{ "enabled": true }`; anything else —
 * missing, malformed, or the string `"true"` — means disabled, so the default
 * is always off.
 */
export const ELECTRONIC_INVOICING_KEY = 'electronicInvoicing' as const;

export interface ElectronicInvoicingSetting {
  enabled: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the activation flag defensively: only a literal `enabled: true`
 * activates an organization, so a malformed blob can never invoice by accident.
 */
export function isElectronicInvoicingActive(settings: unknown): boolean {
  if (!isPlainRecord(settings)) {
    return false;
  }
  const activation = settings[ELECTRONIC_INVOICING_KEY];
  return isPlainRecord(activation) && activation.enabled === true;
}

export interface InvoicingSettings {
  printHeader: string;
  printFooter: string;
}

export interface LocaleSettings {
  currency: string;
  locale: string;
  timezone: string;
}

/** The single, fully-hydrated settings view exposed to readers. */
export interface SettingsView {
  organization: {
    name: string;
    logoUrl: string | null;
    taxId: string | null;
    phone: string | null;
    address: string | null;
  };
  invoicing: InvoicingSettings;
  receipt: {
    prefix: string | null;
  };
  locale: LocaleSettings;
  custom: Record<string, unknown>;
}
