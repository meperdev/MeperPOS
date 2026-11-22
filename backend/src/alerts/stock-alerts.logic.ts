/** The persisted lifecycle of one product's low-stock condition. */
export type StockAlertState = 'OPEN' | 'RESOLVED';

/** The only failure codes an episode may carry; the column stays free text. */
export const STOCK_ALERT_FAILURES = [
  /** No verified OWNER/ADMIN identity in the organization to notify. */
  'no_recipient',
  /** The provider refused the send (non-2xx, missing config, bad session). */
  'provider_rejected',
  /** Anything else the provider call threw. */
  'send_failed',
] as const;

export type StockAlertFailure = (typeof STOCK_ALERT_FAILURES)[number];

/** How many products one message lists before it summarizes the rest. */
export const STOCK_ALERT_MESSAGE_LIMIT = 10;

/** Catalog text is bounded before it reaches a chat: WhatsApp, not HTML. */
export const STOCK_ALERT_NAME_LIMIT = 60;
export const STOCK_ALERT_SKU_LIMIT = 24;

/**
 * Normalizes one catalog field for the message: control characters (including
 * newlines) collapse to a space, runs of whitespace collapse, and the value is
 * truncated. A product name cannot fabricate list lines or smuggle a link into a
 * plain-text notification.
 */
export function cleanCatalogText(value: string, limit: number): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit)
  );
}

export interface EpisodeSnapshot {
  state: StockAlertState;
  episode: number;
}

export type EpisodeDecision =
  | { action: 'open'; episode: 1 }
  | { action: 'reopen'; episode: number }
  | { action: 'keep' }
  | { action: 'resolve' };

/**
 * The episode state machine, pure so every transition is asserted without a
 * database.
 *
 * A product that was never low opens episode 1. A product that was low, recovered
 * and is low again reopens with the next episode number, which is what lets the
 * notification pipeline alert again without ever alerting twice for the same
 * crossing. Everything else keeps the current row untouched.
 */
export function decideEpisode(
  current: EpisodeSnapshot | null,
  isLow: boolean,
): EpisodeDecision {
  if (isLow) {
    if (!current) return { action: 'open', episode: 1 };
    if (current.state === 'RESOLVED') {
      return { action: 'reopen', episode: current.episode + 1 };
    }
    return { action: 'keep' };
  }
  return current?.state === 'OPEN' ? { action: 'resolve' } : { action: 'keep' };
}

export interface StockAlertProduct {
  name: string;
  sku: string;
  stock: number;
  minStock: number;
}

/**
 * The WhatsApp text for one batch of newly opened episodes. Plain, bounded and
 * link-free: the recipient is already inside the conversation, and a URL in a
 * notification is a way to leak a tenant host into the wrong chat.
 */
export function renderStockAlertMessage(
  products: readonly StockAlertProduct[],
  total: number = products.length,
): string {
  const shown = products.slice(0, STOCK_ALERT_MESSAGE_LIMIT);
  const remaining = total - shown.length;
  const header =
    total === 1
      ? 'MeperPOS · Stock bajo\n\n1 producto llegó a su mínimo:'
      : `MeperPOS · Stock bajo\n\n${total} productos llegaron a su mínimo:`;
  const lines = shown.map((product) => {
    const name = cleanCatalogText(product.name, STOCK_ALERT_NAME_LIMIT);
    const sku = cleanCatalogText(product.sku, STOCK_ALERT_SKU_LIMIT);
    return `• ${name} (${sku}): ${product.stock} uds · mínimo ${product.minStock}`;
  });
  const tail =
    remaining > 0
      ? [`… y ${remaining} producto${remaining === 1 ? '' : 's'} más.`]
      : [];
  return [
    header,
    '',
    ...lines,
    ...tail,
    '',
    'Revisa Inventario → Stock bajo en MeperPOS.',
  ].join('\n');
}
