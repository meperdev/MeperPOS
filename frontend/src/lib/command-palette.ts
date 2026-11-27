"use client";

import { useSyncExternalStore } from "react";
import { hasAnyRole, type AppRole } from "@/lib/auth";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import { safeGetItem, safeSetItem } from "@/lib/utils";

/**
 * The command palette's state and the rules behind its groups.
 *
 * Kept out of the component for the same reason `alert-panel-geometry` is: the
 * ledger, the role gates and the search normalization are decisions with one
 * right answer each, and they are cheaper to prove here than through a dialog.
 */

/** Recent entities are per tenant; the SuperAdmin "all organizations" view is `global`. */
export const COMMAND_RECENTS_KEY_PREFIX = "meperpos:command-recents:";
export const COMMAND_RECENTS_LIMIT = 5;

export type CommandRecentKind = "product" | "customer" | "sale";

/**
 * What a recent entry keeps: enough to repaint the row and reopen the entity.
 *
 * Deliberately not the entity: a ledger that stored the price would be a stale
 * price the moment the catalog changed, and the palette reads money from the
 * server every time it shows it.
 */
export interface CommandRecent {
  kind: CommandRecentKind;
  id: string;
  label: string;
}

const RECENT_KINDS: readonly CommandRecentKind[] = ["product", "customer", "sale"];

export function currentOrganizationScope(): string | null {
  return safeGetItem(SELECTED_ORGANIZATION_KEY);
}

export function commandRecentsKey(organizationId: string | null): string {
  return `${COMMAND_RECENTS_KEY_PREFIX}${organizationId ?? "global"}`;
}

function isCommandRecent(value: unknown): value is CommandRecent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.label === "string" &&
    entry.label.length > 0 &&
    RECENT_KINDS.includes(entry.kind as CommandRecentKind)
  );
}

export function readCommandRecents(key: string): CommandRecent[] {
  const raw = safeGetItem(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCommandRecent).slice(0, COMMAND_RECENTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Records one opened entity and returns the new ledger.
 *
 * An entity that is opened again moves to the top instead of appearing twice:
 * the group is a shortlist of where the operator has been, not a log.
 */
export function recordCommandRecent(
  key: string,
  entry: CommandRecent,
): CommandRecent[] {
  const withoutDuplicate = readCommandRecents(key).filter(
    (candidate) => !(candidate.kind === entry.kind && candidate.id === entry.id),
  );
  const next = [entry, ...withoutDuplicate].slice(0, COMMAND_RECENTS_LIMIT);
  safeSetItem(key, JSON.stringify(next));
  return next;
}

export interface CommandCreateAction {
  label: string;
  href: string;
  roles: AppRole[];
}

/**
 * Creation flows reachable by URL.
 *
 * Only two pages can be opened straight on their form: `/pos` is the sale
 * itself and `/purchase-orders/new` is its own route. "Nuevo producto", "Nuevo
 * cliente" and "Registrar salida" open their modal from local state and read no
 * query parameter, so they are left out rather than linking to a list that
 * ignores the intent.
 */
export const commandCreateActions: CommandCreateAction[] = [
  { label: "Nueva venta", href: "/pos", roles: ["ADMIN", "CASHIER"] },
  {
    label: "Nueva orden de compra",
    href: "/purchase-orders/new",
    roles: ["ADMIN", "INVENTORY_USER"],
  },
];

export function visibleCommandCreateActions(
  role: AppRole | string | undefined,
): CommandCreateAction[] {
  return commandCreateActions.filter((action) =>
    hasAnyRole(role, action.roles),
  );
}

/** Lowercase, accent-free text: "Categorías" and "categorias" must agree. */
export function normalizeCommandText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesCommandQuery(text: string, query: string): boolean {
  const normalized = normalizeCommandText(query);
  if (!normalized) return true;
  return normalizeCommandText(text).includes(normalized);
}

export function filterCommandTargets<T extends { label: string }>(
  targets: T[],
  query: string,
): T[] {
  if (!normalizeCommandText(query)) return targets;
  return targets.filter((target) => matchesCommandQuery(target.label, query));
}

/**
 * The number the sales endpoint actually understands.
 *
 * `/sales?search=` parses the term as a sale number and otherwise matches the
 * customer's name, so "venta 194" and "#194" have to become "194" before they
 * leave the palette; anything else is passed through for the name match.
 */
export function salesSearchTerm(query: string): string {
  return query
    .trim()
    .replace(/^#\s*/, "")
    .replace(/^venta\b\s*/i, "")
    .replace(/^#\s*/, "")
    .trim();
}

export type CommandProductSource = "search" | "list";

/**
 * Which products endpoint the role may call.
 *
 * `GET /products/search` is the dedicated name/SKU/barcode search but is limited
 * to ADMIN and CASHIER; the inventory role reads the same three fields
 * through `GET /products?search=`, which carries no role restriction. Returning
 * `null` hides the group instead of firing a request the token cannot read.
 */
export function productSearchSource(
  role: AppRole | string | undefined,
): CommandProductSource | null {
  if (hasAnyRole(role, ["ADMIN", "CASHIER"])) return "search";
  if (hasAnyRole(role, ["INVENTORY_USER"])) return "list";
  return null;
}

export function canSearchCustomers(role: AppRole | string | undefined): boolean {
  return hasAnyRole(role, ["ADMIN", "CASHIER"]);
}

export function canSearchSales(role: AppRole | string | undefined): boolean {
  return hasAnyRole(role, ["ADMIN", "CASHIER"]);
}

/**
 * Where a hit opens.
 *
 * Each link uses a destination the target page already understands; none of
 * them invents a parameter. `/inventory` reads no `search` today, so the product
 * link still names the term and lands on the catalog; `/sales?customerId=` is
 * the link the customers screen itself paints for a customer's history, and
 * `/sales/:id` is the sale detail route.
 */
export function commandProductHref(term: string): string {
  return `/inventory?search=${encodeURIComponent(term)}`;
}

export function commandCustomerHref(id: string, name: string): string {
  return `/sales?customerId=${encodeURIComponent(id)}&customerName=${encodeURIComponent(name)}`;
}

export function commandSaleHref(id: string): string {
  return `/sales/${encodeURIComponent(id)}`;
}

/** A recent entry carries no SKU, so the product link falls back to its label. */
export function commandRecentHref(recent: CommandRecent): string {
  switch (recent.kind) {
    case "product":
      return commandProductHref(recent.label);
    case "customer":
      return commandCustomerHref(recent.id, recent.label);
    case "sale":
      return commandSaleHref(recent.id);
  }
}

/**
 * Open state of the palette.
 *
 * A module-level store because the palette is mounted once by the shell while
 * three different surfaces open it: the desktop header field, the phone's search
 * button and the Ctrl+K shortcut. The server snapshot is always `false`, so the
 * first client frame cannot disagree with the server's markup.
 */
let isPaletteOpen = false;
const paletteListeners = new Set<() => void>();

function emitPalette(next: boolean): void {
  if (next === isPaletteOpen) return;
  isPaletteOpen = next;
  paletteListeners.forEach((listener) => listener());
}

export function subscribeCommandPalette(listener: () => void): () => void {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

export function isCommandPaletteOpen(): boolean {
  return isPaletteOpen;
}

export function openCommandPalette(): void {
  emitPalette(true);
}

export function closeCommandPalette(): void {
  emitPalette(false);
}

export function toggleCommandPalette(): void {
  emitPalette(!isPaletteOpen);
}

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(
    subscribeCommandPalette,
    isCommandPaletteOpen,
    () => false,
  );
}
