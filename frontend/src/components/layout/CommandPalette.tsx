"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CornerDownLeft,
  Package,
  Plus,
  Receipt,
  Search,
  Users,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/contexts/AuthContext";
import { filterNavItems } from "@/components/layout/nav-routes";
import {
  COMMAND_SEARCH_MIN_CHARS,
  useCommandSearch,
} from "@/hooks/useCommandSearch";
import {
  canSearchCustomers,
  canSearchSales,
  closeCommandPalette,
  commandCustomerHref,
  commandProductHref,
  commandRecentHref,
  commandRecentsKey,
  commandSaleHref,
  currentOrganizationScope,
  filterCommandTargets,
  productSearchSource,
  readCommandRecents,
  recordCommandRecent,
  toggleCommandPalette,
  useCommandPaletteOpen,
  visibleCommandCreateActions,
  type CommandRecent,
  type CommandRecentKind,
} from "@/lib/command-palette";
import { cn, formatCurrency } from "@/lib/utils";

const RECENT_KIND_LABELS: Record<CommandRecentKind, string> = {
  product: "Producto",
  customer: "Cliente",
  sale: "Venta",
};

type PaletteSectionKey =
  | "recents"
  | "create"
  | "screens"
  | "products"
  | "customers"
  | "sales";

interface PaletteOption {
  /** DOM id, so the input can point at it with `aria-activedescendant`. */
  id: string;
  label: string;
  hint?: string;
  /**
   * `id-text` is for identifiers only (SKU, barcode, document, sale number):
   * the one sans family with tabular figures. Money and labels are read, not
   * parsed digit by digit, so they keep the plain text face.
   */
  hintMono?: boolean;
  icon: React.ReactNode;
  onOpen: () => void;
}

type PaletteStatusKind = "loading" | "empty" | "error";

interface PaletteSection {
  key: PaletteSectionKey;
  title: string;
  /** Loading, empty and error lines live in the group, not the whole palette. */
  status?: { kind: PaletteStatusKind; text: string };
  options: PaletteOption[];
}

/**
 * The global search, mounted once by the shell and opened from three places.
 *
 * Ctrl+K (or Cmd+K) opens it from anywhere, including from inside a field: the
 * shortcut always carries a modifier, so it can never be a keystroke meant for
 * the text being typed.
 */
export function CommandPalette() {
  const isOpen = useCommandPaletteOpen();

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      toggleCommandPalette();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  // Mounted only while open: every open starts on a clean query and a fresh read
  // of the recents ledger.
  return isOpen ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role;

  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("");
  /**
   * The selected organization when a SuperAdmin is looking at one, otherwise
   * the signed-in user's own tenant: a shared till must not hand the next
   * operator the previous one's recently opened customers.
   */
  const ledgerKey = commandRecentsKey(
    currentOrganizationScope() ?? user?.organizationId ?? null,
  );
  const [recents, setRecents] = useState<CommandRecent[]>(() =>
    readCommandRecents(ledgerKey),
  );

  const search = useCommandSearch(query, role);
  const trimmed = query.trim();
  const isTyping = trimmed.length > 0;

  const goTo = useCallback(
    (href: string) => {
      closeCommandPalette();
      router.push(href);
    },
    [router],
  );

  /** Opening an entity from here is what fills the recents group. */
  const openEntity = useCallback(
    (entry: CommandRecent, href: string) => {
      setRecents(recordCommandRecent(ledgerKey, entry));
      goTo(href);
    },
    [ledgerKey, goTo],
  );

  const visibleNav = filterNavItems(role);
  const productSource = productSearchSource(role);
  const customersAllowed = canSearchCustomers(role);
  const salesAllowed = canSearchSales(role);

  const screenOptions = (items: typeof visibleNav): PaletteOption[] =>
    items.map((item, index) => ({
      id: `${listId}-screens-${index}`,
      label: item.label,
      icon: item.icon,
      onOpen: () => goTo(item.href),
    }));

  const actionOptions = (
    actions: ReturnType<typeof visibleCommandCreateActions>,
  ): PaletteOption[] =>
    actions.map((action, index) => ({
      id: `${listId}-create-${index}`,
      label: action.label,
      icon: <Plus className="h-3.5 w-3.5" aria-hidden="true" />,
      onOpen: () => goTo(action.href),
    }));

  const sections: PaletteSection[] = [];

  if (!isTyping) {
    if (recents.length > 0) {
      sections.push({
        key: "recents",
        title: "Abiertos recientemente",
        options: recents.slice(0, 5).map((recent, index) => ({
          id: `${listId}-recents-${index}`,
          label: recent.label,
          hint: RECENT_KIND_LABELS[recent.kind],
          icon:
            recent.kind === "product" ? (
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
            ) : recent.kind === "customer" ? (
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
            ),
          onOpen: () => openEntity(recent, commandRecentHref(recent)),
        })),
      });
    }

    sections.push({
      key: "create",
      title: "Crear",
      options: actionOptions(visibleCommandCreateActions(role)),
    });

    sections.push({
      key: "screens",
      title: "Ir a",
      options: screenOptions(visibleNav),
    });
  } else {
    const matchingScreens = filterCommandTargets(visibleNav, trimmed);

    sections.push({
      key: "screens",
      title: "Pantallas",
      status:
        matchingScreens.length === 0
          ? { kind: "empty", text: "Sin pantallas." }
          : undefined,
      options: screenOptions(matchingScreens),
    });

    // Typing "nueva" must reach the action, not only the destination. The group
    // leaves the list when no action matches, so it adds no noise of its own.
    const matchingActions = filterCommandTargets(
      visibleCommandCreateActions(role),
      trimmed,
    );
    if (matchingActions.length > 0) {
      sections.push({
        key: "create",
        title: "Crear",
        options: actionOptions(matchingActions),
      });
    }

    // The server-backed groups only exist from two characters on: one character
    // is still typing, and the endpoints would answer a query nobody finished.
    if (trimmed.length >= COMMAND_SEARCH_MIN_CHARS) {
      if (productSource) {
        sections.push({
          key: "products",
          title: "Productos",
          status: groupStatus(search.products.status, search.products.items.length, {
            loading: "Buscando productos…",
            error: "No se pudieron cargar los productos.",
            empty: "Sin productos.",
          }),
          options: search.products.items.map((item, index) => ({
            id: `${listId}-products-${index}`,
            label: item.name,
            hint: formatCurrency(item.price),
            icon: <Package className="h-3.5 w-3.5" aria-hidden="true" />,
            onOpen: () =>
              openEntity(
                { kind: "product", id: item.id, label: item.name },
                commandProductHref(item.sku || item.barcode || item.name),
              ),
          })),
        });
      }

      if (customersAllowed) {
        sections.push({
          key: "customers",
          title: "Clientes",
          status: groupStatus(
            search.customers.status,
            search.customers.items.length,
            {
              loading: "Buscando clientes…",
              error: "No se pudieron cargar los clientes.",
              empty: "Sin clientes.",
            },
          ),
          options: search.customers.items.map((item, index) => ({
            id: `${listId}-customers-${index}`,
            label: item.name,
            hint: item.documentNumber,
            hintMono: true,
            icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
            onOpen: () =>
              openEntity(
                { kind: "customer", id: item.id, label: item.name },
                commandCustomerHref(item.id, item.name),
              ),
          })),
        });
      }

      if (salesAllowed) {
        sections.push({
          key: "sales",
          title: "Ventas",
          status: groupStatus(search.sales.status, search.sales.items.length, {
            loading: "Buscando ventas…",
            error: "No se pudieron cargar las ventas.",
            empty: "Sin ventas.",
          }),
          options: search.sales.items.map((item, index) => ({
            id: `${listId}-sales-${index}`,
            label: `Venta ${item.saleNumber}`,
            hint: item.customerName ?? formatCurrency(item.total),
            icon: <Receipt className="h-3.5 w-3.5" aria-hidden="true" />,
            onOpen: () =>
              openEntity(
                {
                  kind: "sale",
                  id: item.id,
                  label: `Venta ${item.saleNumber}`,
                },
                commandSaleHref(item.id),
              ),
          })),
        });
      }
    }
  }

  const options = sections.flatMap((section) => section.options);
  const hasError = sections.some((section) => section.status?.kind === "error");
  const isLoading = sections.some((section) => section.status?.kind === "loading");
  // Every group empty at once is one sentence, not four "Sin …" lines.
  const showsEmptyMessage =
    isTyping && options.length === 0 && !hasError && !isLoading;

  // Derived, not assigned in an effect: the first option is active as soon as
  // there is one (so Enter opens the top hit), and a stored id that no longer
  // exists — because the query changed the list — falls back to that first row.
  const activeOptionId = options.some((option) => option.id === activeId)
    ? activeId
    : (options[0]?.id ?? "");

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      const index = options.findIndex((option) => option.id === activeOptionId);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + step + options.length) % options.length;
      setActiveId(options[next].id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      options.find((option) => option.id === activeOptionId)?.onOpen();
    }
  };

  return (
    <Modal
      isOpen
      onClose={closeCommandPalette}
      title="Buscar en MeperPOS"
      size="md"
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          data-modal-autofocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeOptionId || undefined}
          aria-autocomplete="list"
          aria-label="Buscar en MeperPOS"
          autoComplete="off"
          spellCheck={false}
          placeholder="Ej.: Arroz 1 kg, ALI-002, Ana Pérez, venta 194"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-10 w-full rounded-lg border border-border/70 bg-muted/40 pl-9 pr-3 text-sm text-foreground transition-colors",
            "placeholder:text-muted-foreground/70 focus:border-primary/60 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/25",
          )}
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Resultados"
        className="mt-3 max-h-[min(56dvh,24rem)] space-y-1 overflow-y-auto scrollbar-app"
      >
        {showsEmptyMessage && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No encontramos resultados para «{trimmed}».
          </p>
        )}

        {(showsEmptyMessage ? [] : sections).map((section) => (
          <div
            key={section.key}
            role="group"
            data-testid="palette-group"
            data-group={section.key}
            aria-labelledby={`${listId}-${section.key}-heading`}
            className="pb-1"
          >
            <p
              id={`${listId}-${section.key}-heading`}
              className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground"
            >
              {section.title}
            </p>

            {section.status && (
              <p
                data-status={section.status.kind}
                className={cn(
                  "px-2.5 py-1.5 text-[11px]",
                  section.status.kind === "error"
                    ? "text-danger-text"
                    : "text-muted-foreground",
                )}
              >
                {section.status.text}
              </p>
            )}

            {section.options.map((option) => {
              const isActive = option.id === activeOptionId;
              return (
                <div
                  key={option.id}
                  id={option.id}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveId(option.id)}
                  onClick={option.onOpen}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                    "max-sm:min-h-11",
                    // The active row is the palette's only selection signal, and
                    // a grey-on-grey one disappears on the light card: the
                    // project's tinted-primary surface plus primary text reads in
                    // both themes (4.8:1 light, 6.3:1 dark).
                    isActive
                      ? "bg-primary-light text-primary-text"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="shrink-0" aria-hidden="true">
                    {option.icon}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isActive ? "text-primary-text" : "text-foreground/90",
                    )}
                  >
                    {option.label}
                  </span>
                  {option.hint && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] tabular-nums",
                        isActive ? "text-foreground/80" : "text-muted-foreground",
                        option.hintMono && "id-text",
                      )}
                    >
                      {option.hint}
                    </span>
                  )}
                  {isActive && (
                    <CornerDownLeft
                      className="h-3 w-3 shrink-0 text-primary-text"
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface GroupCopy {
  loading: string;
  error: string;
  empty: string;
}

/** One line per group: loading, empty, or the recovery of a failed request. */
function groupStatus(
  status: "idle" | "loading" | "ready" | "error",
  count: number,
  copy: GroupCopy,
): { kind: PaletteStatusKind; text: string } | undefined {
  if (status === "loading") return { kind: "loading", text: copy.loading };
  if (status === "error") return { kind: "error", text: copy.error };
  if (status === "ready" && count === 0) return { kind: "empty", text: copy.empty };
  return undefined;
}
