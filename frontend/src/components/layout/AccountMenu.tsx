"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  LogOut,
  Settings,
  Smartphone,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInstallPrompt } from "@/contexts/InstallPromptContext";
import { visibleAccountMenuSections } from "@/components/layout/nav-routes";
import { cn } from "@/lib/utils";

const roleLabels: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
  SUPER_ADMIN: "Super administrador",
};

/**
 * The destinations this menu words for itself.
 *
 * All three come from `visibleAccountMenuSections`, so the audience is the same
 * list `DashboardLayout`'s route gate admits — a row the gate would bounce is
 * never offered. The alert history belongs here as well as in the bell's panel:
 * the panel's header link is the quick read on the way out, and this row is the
 * one the operator goes looking for when the panel is closed.
 */
const ACCOUNT_MENU_HREFS = new Set(["/profile", "/alerts", "/settings"]);

function iconForHref(href: string) {
  if (href === "/settings")
    return <Settings className="h-3.5 w-3.5" aria-hidden="true" />;
  if (href === "/alerts")
    return <Bell className="h-3.5 w-3.5" aria-hidden="true" />;
  return <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />;
}

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * The header's account button: initials that open everything belonging to this
 * identity rather than to the day's work.
 *
 * The menu is not `RowActions` because its first block is the identity itself
 * (name and role), which a list of actions cannot carry; the keyboard contract
 * is the same one — arrow keys walk the rows, Escape and an outside click close
 * it, and focus returns to the avatar.
 */
export function AccountMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { isAvailable, promptInstall } = useInstallPrompt();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  useEffect(() => {
    if (!open) return;

    // The first row, not the trigger: opening a menu should land on its first
    // decision, and Tab then keeps walking from there.
    const focusFirst = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      setOpen(false);
      triggerRef.current?.focus();
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close(event);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const entries = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
          [],
      );
      if (entries.length === 0) return;
      event.preventDefault();
      const index = entries.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    };

    const handleScroll = () => setOpen(false);

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open]);

  if (!user) return null;

  const items: MenuItem[] = visibleAccountMenuSections(user.role)
    .filter((section) => ACCOUNT_MENU_HREFS.has(section.href))
    .map((section) => ({
      key: section.href,
      label: section.label,
      icon: iconForHref(section.href),
      onSelect: () => router.push(section.href),
    }));

  // The theme is not here: the header carries the mode as its own control, next
  // to the bell and the avatar. Repeating it would be a second switch for one
  // setting, and the row that repeated it is gone on purpose.

  // Only a browser that can actually install the app offers it; the settings
  // screen carries the manual recipe for an iPhone, the menu does not.
  if (isAvailable) {
    items.push({
      key: "install",
      label: "Instalar aplicación",
      icon: <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />,
      onSelect: () => {
        void promptInstall();
      },
    });
  }

  items.push({
    key: "logout",
    label: "Cerrar sesión",
    icon: <LogOut className="h-3.5 w-3.5" aria-hidden="true" />,
    onSelect: logout,
    destructive: true,
  });

  const runItem = (item: MenuItem) => {
    setOpen(false);
    item.onSelect();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Opciones de cuenta"
        title={user.name}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          // The sand series ink the dashboard already speaks: the initials are
          // an identity mark, not a teal control. The light-mode value is a
          // darker sand because 12px on a 15% tint of the lighter one lands
          // under 4.5:1; dark mode uses the token itself.
          "grid h-8 w-8 place-items-center rounded-full bg-chart-ink/15 text-xs font-semibold text-[#6F5C40] transition-colors dark:text-chart-ink",
          "hover:bg-chart-ink/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        )}
      >
        <span aria-hidden="true">{initials}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Opciones de cuenta"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg shadow-black/10 animate-fade-in"
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-foreground">
              {user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {roleLabels[user.role] ?? user.role}
            </p>
          </div>

          <div role="separator" className="my-1 h-px bg-border/70" />

          {items.map((item) => (
            <div key={item.key}>
              {item.destructive && (
                <div role="separator" className="my-1 h-px bg-border/70" />
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => runItem(item)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  // A grey hover on the white card is 1.09:1 — invisible — and
                  // the focus ring alone leaves the keyboard with no row state.
                  // The palette's tinted-primary surface is the one signal that
                  // reads in both themes; the icon inherits currentColor with
                  // the label. Cerrar sesión keeps its danger hue.
                  item.destructive
                    ? "text-danger-text hover:bg-danger/10 focus-visible:bg-danger/10"
                    : "text-foreground hover:bg-primary-light hover:text-primary-text focus-visible:bg-primary-light focus-visible:text-primary-text",
                )}
              >
                {item.icon}
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
