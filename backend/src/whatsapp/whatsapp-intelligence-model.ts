import { Injectable } from '@nestjs/common';

/**
 * The model seam of the administrative assistant.
 *
 * This file is the whole boundary: what a provider may be asked, what it is
 * allowed to answer, and the limits that apply to both. No provider is chosen
 * here and none is reached from this file; the decision about provider, model,
 * budget and where the text may be processed is still open, so the shipped
 * binding is {@link UnconfiguredWhatsAppModelProvider}, which never calls
 * anything and always refuses.
 *
 * Two properties matter more than the mechanics:
 *
 *  - **A model can only pick one of the closed read tools.** The intent shape
 *    has no room for a parameter, an identifier, an organization or a filter,
 *    so nothing a sender writes can widen what is read: the organization is
 *    always the verified identity's own, taken from the gate's context and
 *    never from the model.
 *  - **A model can never make the gate send anything.** The report-PDF tool is
 *    deliberately absent from {@link MODEL_TOOL_NAMES}: a document leaves the
 *    system only when an administrator asked for it in the deterministic
 *    allowlist, never because a model guessed.
 */

/** The only tools a model may select. Read-only, and no document delivery. */
export const MODEL_TOOL_NAMES = [
  'daily_summary',
  'supervision_summary',
] as const;

export type WhatsAppModelTool = (typeof MODEL_TOOL_NAMES)[number];

export interface WhatsAppModelToolDescription {
  readonly name: WhatsAppModelTool;
  readonly description: string;
}

/**
 * The catalogue sent with every request. Static text, identical for every
 * sender and every organization: it carries no figure, no name and no
 * identifier, so it adds nothing to the data a provider sees.
 */
export const MODEL_TOOLS: readonly WhatsAppModelToolDescription[] = [
  {
    name: 'daily_summary',
    description:
      'Totales del cierre del día del negocio: ventas, gastos, stock bajo, órdenes de compra pendientes y préstamos por vencer.',
  },
  {
    name: 'supervision_summary',
    description:
      'Estado agregado de las conversaciones de atención: totales por estado y por tipo de contacto, cuántas esperan respuesta y la mediana de la primera respuesta.',
  },
];

/**
 * Longest body that may be sent to a provider. A chat message is short by
 * nature; anything longer is not a command this stage is willing to pay to
 * interpret, so it is refused before any call is attempted.
 */
export const MODEL_REQUEST_MAX_CHARS = 512;

/**
 * The adapter's deadline for one interpretation. It is part of the request so a
 * provider cannot silently choose its own; exceeding it must surface as
 * `unavailable`, which the gate turns into the same refusal a stranger sees as
 * a service error.
 */
export const MODEL_TIMEOUT_MS = 5_000;

/**
 * One interpretation per inbound message, no retries. Not enforced by a counter
 * here but by the single call site: a retry would multiply the cost of a
 * message the sender can repeat for free, and the webhook receipt is already
 * spent by the time the gate runs.
 */
export const MODEL_CALLS_PER_MESSAGE = 1;

export const WHATSAPP_MODEL_PROVIDER = Symbol('WHATSAPP_MODEL_PROVIDER');

/**
 * Exactly what a provider is given: the normalised text the sender wrote, the
 * closed catalogue and the deadline. There is no field for a phone, an
 * identity, an organization, a conversation, a figure or a history, so no
 * future caller can add one without changing this type.
 */
export interface WhatsAppModelRequest {
  /** The same normalised text the deterministic allowlist compared. */
  readonly text: string;
  readonly tools: readonly WhatsAppModelToolDescription[];
  readonly timeoutMs: number;
}

/** A tool selection and nothing else: no parameter, no identifier, no filter. */
export interface WhatsAppModelIntent {
  readonly tool: WhatsAppModelTool;
}

export type WhatsAppModelResult =
  | { readonly status: 'intent'; readonly intent: WhatsAppModelIntent }
  /** The model understood the text and it asks for no available tool. */
  | { readonly status: 'unsupported' }
  /** The provider is not configured, refused, timed out or failed. */
  | { readonly status: 'unavailable' };

/**
 * A provider capable of mapping an administrator's phrasing onto the closed
 * tool catalogue.
 *
 * It receives only a {@link WhatsAppModelRequest}, and everything it answers is
 * validated again by {@link parseModelIntent} on this side: a provider is
 * untrusted output, not an authority. `unsupported` and `unavailable` are
 * distinct on purpose so an operator can tell a legitimate "I don't know that
 * command" from a broken integration, even though the administrator is never
 * told which one happened.
 */
export interface WhatsAppModelProvider {
  interpret(request: WhatsAppModelRequest): Promise<WhatsAppModelResult>;
}

/**
 * The shipped binding while no provider is chosen. It reaches nothing, costs
 * nothing and always refuses, so the administrative channel keeps answering
 * exactly as it did before the seam existed: only the deterministic allowlist
 * produces an answer.
 */
@Injectable()
export class UnconfiguredWhatsAppModelProvider implements WhatsAppModelProvider {
  interpret(): Promise<WhatsAppModelResult> {
    return Promise.resolve({ status: 'unavailable' });
  }
}

/**
 * Build the request, or `null` when the text is out of bounds and must not
 * reach a provider at all.
 *
 * The argument is the already-normalised command (see `normaliseCommand`), so
 * there is exactly one notion of "what the administrator wrote" in the system:
 * the same string the allowlist compared and the same string a model sees.
 */
export function buildModelRequest(
  command: unknown,
): WhatsAppModelRequest | null {
  if (typeof command !== 'string') return null;
  if (command.length === 0) return null;
  if (command.length > MODEL_REQUEST_MAX_CHARS) return null;
  return { text: command, tools: MODEL_TOOLS, timeoutMs: MODEL_TIMEOUT_MS };
}

/**
 * Validate a provider's answer on this side.
 *
 * Accepts exactly one shape — an object whose only own property is a `tool`
 * naming a catalogue entry — and returns `null` for everything else, including
 * the three ways a provider is most likely to go wrong:
 *
 *  - an unknown or differently cased tool name (`DAILY_SUMMARY`,
 *    `list_customers`, `daily_report_pdf`), because the catalogue is closed;
 *  - any extra property (`organizationId`, `phone`, `customerId`, `since`,
 *    `text`), because no tool takes a parameter and an ignored parameter is a
 *    capability someone will eventually read;
 *  - anything that is not a plain object, because a provider that answers with a
 *    string is answering with unvalidated prose.
 */
export function parseModelIntent(raw: unknown): WhatsAppModelIntent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'tool') return null;
  const tool = record.tool;
  if (typeof tool !== 'string') return null;
  return MODEL_TOOL_NAMES.includes(tool as WhatsAppModelTool)
    ? { tool: tool as WhatsAppModelTool }
    : null;
}
