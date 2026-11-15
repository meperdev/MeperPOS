"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Bell,
  Check,
  ClipboardList,
  CreditCard,
  Gauge,
  HandCoins,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeAlertPanelGeometry,
  type AlertPanelGeometry,
} from "@/components/layout/alert-panel-geometry";
import { useAuth } from "@/contexts/AuthContext";
import { useAlerts, type AlertCategory, type AppAlert } from "@/hooks/useAlerts";

const SEEN_PREFIX = "meperpos:alerts-seen:";
const SEEN_EVENT = "meperpos:alerts-seen-changed";

const CATEGORY_ICON: Record<AlertCategory, React.ReactNode> = {
  billing: <CreditCard className="h-4 w-4" aria-hidden="true" />,
  limits: <Gauge className="h-4 w-4" aria-hidden="true" />,
  stock: <Package className="h-4 w-4" aria-hidden="true" />,
  loans: <HandCoins className="h-4 w-4" aria-hidden="true" />,
  tasks: <ClipboardList className="h-4 w-4" aria-hidden="true" />,
};

/**
 * The read ledger is a map of alert id to the revision the reader acknowledged.
 * A revision mismatch is what makes the bell ring again: the same low-stock alert
 * re-alerts when the set of low products changes, and a condition that comes back
 * after being resolved is new again. The previous shape (a plain array of ids)
 * silently muted every future occurrence of a condition.
 */
type SeenLedger = Record<string, string>;

function readSeen(key: string): SeenLedger {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const seen: SeenLedger = {};
    for (const [id, revision] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof revision === "string") seen[id] = revision;
    }
    return seen;
  } catch {
    return {};
  }
}

function writeSeen(key: string, seen: SeenLedger): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    // Storage can be blocked; the in-memory ledger still works for this session.
  }
  // The desktop rail and the mobile header each mount a bell; keep them in sync.
  window.dispatchEvent(new CustomEvent(SEEN_EVENT, { detail: { key, seen } }));
}

const emptySubscribe = () => () => {};

export function AlertCenter({
  className,
  buttonClassName,
  collapsed = false,
}: {
  className?: string;
  /** Trigger surface; the rail styles it as a tile instead of a bare glyph. */
  buttonClassName?: string;
  collapsed?: boolean;
}) {
  const { user, organization } = useAuth();
  const alerts = useAlerts();

  const storageKey = `${SEEN_PREFIX}${user?.organizationId ?? organization?.id ?? "global"}`;
  const [seen, setSeen] = useState<SeenLedger>(() => readSeen(storageKey));
  const [syncedKey, setSyncedKey] = useState(storageKey);

  // Organization switch: the ledger is per tenant, so swap it during render.
  if (syncedKey !== storageKey) {
    setSyncedKey(storageKey);
    setSeen(readSeen(storageKey));
  }

  // Local storage is client-only; withhold the badge so SSR and hydration match.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const [open, setOpen] = useState(false);
  // Snapshot of what was unread when the panel opened: the badge clears on open,
  // but the rows keep their "new" dot for that visit.
  const [openedUnread, setOpenedUnread] = useState<string[]>([]);
  const [coords, setCoords] = useState<AlertPanelGeometry | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = alerts.filter((alert) => seen[alert.id] !== alert.revision);
  const unreadCount = mounted ? unread.length : 0;

  const markSeen = useCallback(
    (entries: AppAlert[]) => {
      const next: SeenLedger = { ...seen };
      for (const entry of entries) next[entry.id] = entry.revision;
      setSeen(next);
      writeSeen(storageKey, next);
    },
    [seen, storageKey],
  );

  // Another mounted bell (desktop rail vs mobile header) may have written first.
  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; seen: SeenLedger }>)
        .detail;
      if (detail?.key === storageKey) setSeen(detail.seen);
    };
    window.addEventListener(SEEN_EVENT, onChanged);
    return () => window.removeEventListener(SEEN_EVENT, onChanged);
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // The geometry is measured once; a viewport change would leave it stale.
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const element = buttonRef.current;
    if (element && window.innerWidth >= 1024) {
      const rect = element.getBoundingClientRect();
      const sidebar = element.closest("[data-sidebar-root]");
      const railRight = sidebar
        ? sidebar.getBoundingClientRect().right
        : rect.right;
      setCoords(
        computeAlertPanelGeometry({
          anchor: rect,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          railRight,
        }),
      );
    } else {
      setCoords(null);
    }
    setOpenedUnread(unread.map((alert) => alert.id));
    setOpen(true);
    if (unread.length > 0) {
      markSeen(alerts);
    }
  };

  const tone =
    unread.length === 0
      ? null
      : unread.some((alert) => alert.severity === "critical")
        ? "bg-danger"
        : "bg-warning";

  return (
    <div className={cn("inline-flex", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 ? `Alertas, ${unreadCount} sin leer` : "Alertas"
        }
        title="Alertas"
        className={cn(
          "relative flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground lg:h-8 lg:w-8",
          collapsed && "mx-auto",
          buttonClassName,
        )}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {tone && (
          <span
            aria-hidden="true"
            data-testid="alert-badge"
            className={cn(
              "absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-2 ring-card",
              tone,
            )}
          />
        )}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Alertas"
            style={coords ?? undefined}
            className={cn(
              "fixed z-[95] flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/10",
              coords
                ? "w-[22rem]"
                : "inset-x-3 top-16 max-h-[calc(100dvh-5rem)]",
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-xs font-semibold text-foreground">Alertas</h2>
                {openedUnread.length > 0 && (
                  <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                    {openedUnread.length}
                  </span>
                )}
              </div>
            </div>

            {alerts.length === 0 ? (
              <div className="px-3.5 py-8 text-center">
                <Check className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-xs font-medium text-foreground">Todo en orden</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  No hay alertas pendientes.
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto scrollbar-app">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <AlertRow
                      alert={alert}
                      unread={openedUnread.includes(alert.id)}
                      onOpen={() => {
                        markSeen([alert]);
                        setOpen(false);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border/60 px-3.5 py-2">
              <Link
                href="/alerts"
                onClick={() => setOpen(false)}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Ver historial de notificaciones
              </Link>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function AlertRow({
  alert,
  unread,
  onOpen,
}: {
  alert: AppAlert;
  unread: boolean;
  onOpen: () => void;
}) {
  return (
    <Link
      href={alert.href}
      onClick={onOpen}
      className="flex items-start gap-2 px-3.5 py-2.5 transition-colors duration-150 hover:bg-muted/40"
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          alert.severity === "critical"
            ? "text-danger-text"
            : alert.severity === "warning"
              ? "text-warning-text"
              : "text-muted-foreground",
        )}
      >
        {CATEGORY_ICON[alert.category]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">
          {alert.title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
          {alert.detail}
        </span>
      </span>
      {unread && (
        <span
          aria-hidden="true"
          data-testid="alert-unread-dot"
          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
        />
      )}
    </Link>
  );
}
