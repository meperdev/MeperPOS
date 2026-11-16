"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { isNavItemActive, mobileTabsFor } from "./nav-routes";
import { useMobileDrawer } from "./mobile-drawer";

export const MOBILE_TAB_BAR_LABEL = "Secciones principales";

/**
 * The phone's primary navigation: the four daily sections plus "Más", which
 * opens the same drawer the hamburger used to. It is a shortcut into the rail,
 * not a second map of it — labels and audiences come from `nav-routes`, so a
 * tab can neither appear for a role the rail hides nor be worded differently.
 *
 * Solid `bg-card` with a hairline on top (D5: no blur), fixed to the bottom edge
 * and paying the home-indicator inset itself. `z-30` keeps it under the drawer
 * (z-50), which covers the whole screen when it opens. Every tab is a plain
 * `<Link>`: the section change is Next's own client navigation, so nothing
 * captures the page on the way.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isOpen, toggle } = useMobileDrawer();
  const tabs = mobileTabsFor(user?.role);

  const itemClass = (isActive: boolean) =>
    cn(
      "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1",
      "text-[11px] font-medium leading-none transition-colors",
      "active:bg-muted/70",
      isActive ? "text-primary" : "text-muted-foreground",
    );

  return (
    <nav
      aria-label={MOBILE_TAB_BAR_LABEL}
      data-testid="mobile-tab-bar"
      className={cn(
        "lg:hidden fixed inset-x-0 bottom-0 z-30 flex items-stretch",
        "h-[calc(var(--mobile-tabbar)+var(--safe-bottom))] pb-[var(--safe-bottom)]",
        "pl-[var(--safe-left)] pr-[var(--safe-right)]",
        "bg-card border-t border-border",
      )}
    >
      {tabs.map((tab) => {
        const isActive = isNavItemActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={itemClass(isActive)}
          >
            <span aria-hidden="true" className="shrink-0">
              {tab.icon}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls="mobile-nav-drawer"
        className={itemClass(false)}
      >
        <span aria-hidden="true" className="shrink-0">
          <Menu className="h-5 w-5" />
        </span>
        <span className="max-w-full truncate">Más</span>
      </button>
    </nav>
  );
}
