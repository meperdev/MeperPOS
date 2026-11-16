"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { OrganizationSwitcher } from "@/components/auth/OrganizationSwitcher";
import { AlertCenter } from "@/components/layout/AlertCenter";
import { useQueryClient } from "@tanstack/react-query";
import { applyOrganizationScope } from "@/lib/organizationScope";

export { applyOrganizationScope };
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import {
  Settings,
  LogOut,
  Moon,
  Sun,
  User as UserIcon,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  X,
} from "lucide-react";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { formatSidebarClock } from "@/components/layout/sidebar-clock";
import { useTheme } from "@/contexts/ThemeContext";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn, safeGetItem, safeSetItem } from "@/lib/utils";
import { APP_NAME, RAIL_FLYOUT_GAP } from "@/lib/constants";
import { hasAnyRole } from "@/lib/auth";
import { startRouteTransition, navigateWithRouteTransition } from "@/lib/viewTransition";
import {
  filterNavItems,
  isNavItemActive,
  mobileTabsFor,
  type NavItem,
} from "@/components/layout/nav-routes";
import { useMobileDrawer } from "@/components/layout/mobile-drawer";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { useState, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

/** Rail scroll offset, kept across the session shell remounting around it. */
export const SIDEBAR_SCROLL_KEY = "meper_sidebar_scroll_top";

const roleLabels: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
};

// Footer actions are frameless icon buttons: the bell and the ⋮ menu are the
// only chrome the account area keeps, so they share one treatment.
// The footer clock is a store of the current minute. The server snapshot is null,
// so SSR and hydration render no time; the client fills it in after hydration.
const CLOCK_TICK_MS = 60_000;
function subscribeToClock(onTick: () => void) {
  const intervalId = window.setInterval(onTick, CLOCK_TICK_MS);
  return () => window.clearInterval(intervalId);
}
function getClockMinute() {
  return Math.floor(Date.now() / CLOCK_TICK_MS);
}
function getServerClockMinute(): null {
  return null;
}

const footerIconButtonClass =
  "h-9 w-9 lg:h-9 lg:w-9 rounded-lg border-transparent bg-transparent text-muted-foreground transition-colors hover:border-transparent hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const avatarCircleClass =
  "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, switchOrganization } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isCollapsed, toggleCollapse } = useSidebar();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => {
    return safeGetItem(SELECTED_ORGANIZATION_KEY);
  });
  // The drawer's open state is shared: the tab bar's "Más" opens the drawer this
  // component renders, so neither can own the other's state.
  const { isOpen: isMobileMenuOpen, close: closeMobileMenu } = useMobileDrawer();
  const [hoveredTooltip, setHoveredTooltip] = useState<{
    label: string;
    top: number;
  } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const hasRestoredScrollRef = useRef(false);
  const restoredScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });

  const filteredItems = filterNavItems(user?.role);

  // The tab bar already offers four sections on a phone, so the drawer — which
  // is the "everything else" surface there — drops their rows below `lg` and
  // keeps every row at `lg`, where it is the rail. One rule for both, read from
  // the same list the tab bar renders, so a tab and its row can never disagree.
  const mobileTabHrefs = new Set(mobileTabsFor(user?.role).map((tab) => tab.href));

  // Consecutive items sharing a group collapse into one labelled block, so the
  // approved operational order survives while the rail gains a scannable spine.
  const navGroups = filteredItems.reduce<
    Array<{ label: string; items: NavItem[]; hiddenBelowLg: boolean }>
  >((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) {
      last.items.push(item);
    } else {
      groups.push({ label: item.group, items: [item], hiddenBelowLg: false });
    }
    return groups;
  }, []).map((group) => ({
    ...group,
    // A heading with nothing under it at phone width is noise: the whole block
    // leaves the drawer and comes back with the rail.
    hiddenBelowLg: group.items.every((item) => mobileTabHrefs.has(item.href)),
  }));

  // Escape is the keyboard way out of a drawer that owns the left edge.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileMenuOpen, closeMobileMenu]);

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isMobileMenuOpen]);


  // The rail paints no scrollbar, so the edge fades are its only affordance:
  // they follow the real overflow instead of the content length.
  const syncScrollEdges = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const remaining = nav.scrollHeight - nav.clientHeight - nav.scrollTop;
    setScrollEdges({
      top: nav.scrollTop > 2,
      bottom: remaining > 2,
    });
  }, []);

  const persistScrollTop = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    safeSetItem(SIDEBAR_SCROLL_KEY, String(Math.round(nav.scrollTop)));
  }, []);

  // Restore the rail offset before the first paint. The authenticated shell
  // unmounts the sidebar while the session is restored, so without this every
  // session entry renders the navigation at the top and then jumps to the item.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;

    const stored = Number(safeGetItem(SIDEBAR_SCROLL_KEY) ?? 0);
    if (Number.isFinite(stored) && stored > 0) {
      nav.scrollTop = stored;
      restoredScrollTopRef.current = stored;
    }
    syncScrollEdges();
  }, [syncScrollEdges]);

  // Scroll the active nav item into view only if it is actually hidden outside
  // the viewport, and before paint so the rail never appears to jump. Right
  // after a restored offset the user's own position wins over the anchor.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    if (restoredScrollTopRef.current > 0) {
      restoredScrollTopRef.current = 0;
      syncScrollEdges();
      return;
    }

    const activeLink = nav.querySelector<HTMLElement>(".sidebar-item.active");
    if (activeLink) {
      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      const isOutOfView =
        linkRect.top < navRect.top || linkRect.bottom > navRect.bottom;

      if (isOutOfView && activeLink.scrollIntoView) {
        activeLink.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }

    syncScrollEdges();
  }, [pathname, isCollapsed, syncScrollEdges]);

  // Persist and re-measure on a frame: a wheel gesture fires far more scroll
  // events than the fades or the stored offset ever need.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const handleScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        syncScrollEdges();
        persistScrollTop();
      });
    };

    nav.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      nav.removeEventListener("scroll", handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [syncScrollEdges, persistScrollTop]);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  // Everything that belongs to this identity, not to the daily operation, lives
  // in one menu: the rail spine stays for the work itself.
  const canSeeSettings = Boolean(user && hasAnyRole(user.role, ["ADMIN"]));
  const accountItems: RowActionItem[] = [
    {
      label: "Mi perfil",
      icon: <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />,
      onSelect: () => {
        closeMobileMenu();
        startRouteTransition(() => router.push("/profile"));
      },
    },
    ...(canSeeSettings
      ? [
          {
            label: "Configuración",
            icon: <Settings className="h-3.5 w-3.5" aria-hidden="true" />,
            onSelect: () => {
              closeMobileMenu();
              startRouteTransition(() => router.push("/settings"));
            },
          } satisfies RowActionItem,
        ]
      : []),
    {
      label:
        theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
      icon:
        theme === "dark" ? (
          <Sun className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Moon className="h-3.5 w-3.5" aria-hidden="true" />
        ),
      onSelect: toggleTheme,
    },
    { kind: "separator" },
    {
      label: "Cerrar sesión",
      icon: <LogOut className="h-3.5 w-3.5" aria-hidden="true" />,
      onSelect: logout,
      destructive: true,
    },
  ];

  const clockMinute = useSyncExternalStore(subscribeToClock, getClockMinute, getServerClockMinute);
  const now = clockMinute === null ? null : new Date(clockMinute * CLOCK_TICK_MS);
  const clockLabel = now ? formatSidebarClock(now) : null;
  const clockIso = now?.toISOString();

  const sidebarContent = (
    <>
      {/* Block 1: Brand - logo and wordmark sized to read as one lockup. The
          drawer is 280px wide and now spends 44 of them on its close control,
          so the lockup steps down a size below lg and keeps its full size on
          the 320px rail. */}
      <div
        data-testid="sidebar-brand"
        className={cn(
          "border-b border-border/70 shrink-0",
          isCollapsed
            ? "px-2 py-4 flex flex-col items-center gap-3"
            : "px-4 py-4 lg:px-5 lg:py-5 flex items-center justify-between gap-2 lg:gap-3"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 min-w-0 lg:gap-3.5",
            isCollapsed && "justify-center"
          )}
        >
          <Image
            src="/brand/icon-192.png"
            alt={`${APP_NAME} logo`}
            width={192}
            height={192}
            className={cn(
              "shrink-0 object-contain drop-shadow-xs",
              isCollapsed ? "w-11 h-11" : "w-10 h-10 lg:w-14 lg:h-14"
            )}
          />
          <p
            className={cn(
              "text-2xl lg:text-[30px] font-bold text-foreground truncate leading-none tracking-tight",
              isCollapsed ? "sr-only" : "min-w-0"
            )}
          >
            Meper
            <span className="text-[#B45309] underline decoration-[#B45309] decoration-[3.5px] underline-offset-[6px] dark:text-[#FF9933] dark:decoration-[#FF9933]">
              POS
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={toggleCollapse}
          data-testid="sidebar-collapse-toggle"
          className="hidden lg:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          aria-label={isCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
          title={isCollapsed ? "Expandir barra lateral (Ctrl+B)" : "Colapsar barra lateral (Ctrl+B)"}
        >
          {isCollapsed ? (
            <ChevronsRight className="w-4 h-4" />
          ) : (
            <ChevronsLeft className="w-4 h-4" />
          )}
        </button>
        {/* The drawer's own way out. The tab bar's "Más" opens it, and the
            overlay, a link or Escape close it, but a control the thumb can
            reach belongs at the top of a surface that covers 280 of 390px. */}
        <button
          type="button"
          onClick={closeMobileMenu}
          className="lg:hidden -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
          aria-label="Cerrar menú"
        >          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Block 2: Navigation - role-filtered, active styling, edge-faded scroll */}
      <div className="relative flex-1 min-h-0">
        <nav
          data-testid="sidebar-nav"
          ref={navRef}
          className={cn(
            "h-full overflow-y-auto overscroll-contain pb-[calc(5rem+var(--safe-bottom))] lg:pb-3 sidebar-scroll",
            isCollapsed ? "px-2 py-3" : "px-3 py-3"
          )}
        >
          {navGroups.map((group, groupIndex) => (
            <div
              key={group.label}
              data-nav-group={group.label}
              className={cn(
                groupIndex > 0 ? (isCollapsed ? "mt-2" : "mt-4") : undefined,
                group.hiddenBelowLg && "hidden lg:block"
              )}
            >
              {!isCollapsed && (
                <p className="mb-1.5 px-2 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
              )}
              <div
                className={cn(
                  "flex flex-col",
                  isCollapsed ? "items-center gap-1" : "gap-0.5"
                )}
              >
                {group.items.map((item) => {
                  const isActive = isNavItemActive(pathname, item.href);
  
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(event) => {
                        closeMobileMenu();
                        setHoveredTooltip(null);
                        // Already here: the drawer closes and nothing fades.
                        if (isActive) return;
                        navigateWithRouteTransition(event, () =>
                          router.push(item.href),
                        );
                      }}
                      onMouseEnter={(e) => {
                        if (isCollapsed) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredTooltip({
                            label: item.label,
                            top: rect.top + rect.height / 2,
                          });
                        }
                      }}
                      onMouseLeave={() => setHoveredTooltip(null)}
                      className={cn(
                        "sidebar-item flex items-center rounded-md text-[13px] font-medium select-none transition-colors duration-150",
                        isCollapsed
                          ? "mx-auto h-9 w-9 justify-center"
                          : "h-11 w-full gap-2 px-2 lg:h-9",
                        // A row the tab bar already offers leaves the drawer but
                        // comes back with the rail; tailwind-merge drops the bare
                        // `flex` so `hidden` actually wins below lg.
                        mobileTabHrefs.has(item.href) && "hidden lg:flex",
                        isActive
                          ? "active bg-muted/70 text-foreground"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      )}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <span
                        className={cn(
                          "shrink-0 flex items-center justify-center",
                          isActive ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {item.icon}
                      </span>
                      <span
                        className={cn("truncate", isCollapsed ? "sr-only" : "inline")}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* The rail hides its scrollbar, so these fades carry the affordance */}
        <div
          aria-hidden="true"
          data-testid="sidebar-scroll-fade-top"
          data-visible={scrollEdges.top}
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-card to-transparent transition-opacity duration-200",
            scrollEdges.top ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          aria-hidden="true"
          data-testid="sidebar-scroll-fade-bottom"
          data-visible={scrollEdges.bottom}
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent transition-opacity duration-200",
            scrollEdges.bottom ? "opacity-100" : "opacity-0"
          )}
        />
      </div>

      {/* Block 3: Account - clock, identity and the account menu, fused */}

      {user && (
        <div
          data-testid="sidebar-user"
          className={cn(
            "border-t border-border/70 shrink-0",
            isCollapsed ? "px-2 py-3" : "px-3 py-3"
          )}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-1">
              <AlertCenter
                collapsed
                className="inline-flex"
                buttonClassName={footerIconButtonClass}
              />

              <RowActions
                label="Opciones de cuenta"
                menuOffset={RAIL_FLYOUT_GAP}
                preferSide="right"
                items={accountItems}
                triggerClassName={cn(footerIconButtonClass, "rounded-full")}
                triggerContent={
                  <span aria-hidden="true" className={avatarCircleClass}>
                    {initials}
                  </span>
                }
              />

              <button
                type="button"
                onClick={toggleCollapse}
                className={cn(footerIconButtonClass, "flex items-center justify-center")}
                aria-label="Mostrar organizaciones (expandir barra)"
                title="Mostrar organizaciones (expandir barra)"
              >
                <Building2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* The time leads the footer as one quiet line; the identity row
                  and its two actions sit under it. */}
              {/* The slot holds its line before mount, so the clock appearing does not shift the footer. */}
              <div data-testid="sidebar-clock-slot" className="flex h-4 min-w-0 items-center">
                {now && (
                  <time
                    data-testid="sidebar-clock"
                    dateTime={clockIso}
                    className="truncate text-xs tabular-nums text-muted-foreground"
                  >
                    {clockLabel}
                  </time>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span aria-hidden="true" className={avatarCircleClass}>
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {roleLabels[user.role] ?? user.role}
                    </span>
                  </span>
                </div>

                <AlertCenter
                  className="shrink-0"
                  buttonClassName={footerIconButtonClass}
                />

                <RowActions
                  label="Opciones de cuenta"
                  menuOffset={RAIL_FLYOUT_GAP}
                  preferSide="right"
                  items={accountItems}
                  triggerClassName={footerIconButtonClass}
                  triggerContent={
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  }
                />
              </div>

              {user.isSuperAdmin ? (
                <OrganizationSwitcher
                  placement="up"
                  currentOrganizationId={selectedOrgId}
                  onSwitch={async (orgId) => {
                    setSelectedOrgId(orgId);
                    applyOrganizationScope(queryClient, orgId);
                  }}
                  isSuperAdmin
                  onSelectAll={() => {
                    setSelectedOrgId(null);
                    applyOrganizationScope(queryClient, null);
                  }}
                />
              ) : (
                <OrganizationSwitcher
                  placement="up"
                  currentOrganizationId={user.organizationId ?? undefined}
                  onSwitch={switchOrganization}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating tooltip for collapsed rail items */}
      {isCollapsed && hoveredTooltip && (
        <div
          data-testid="sidebar-rail-tooltip"
          style={{ top: hoveredTooltip.top }}
          className="fixed left-[78px] -translate-y-1/2 z-[70] rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-lg pointer-events-none whitespace-nowrap animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {hoveredTooltip.label}
        </div>
      )}

    </>
  );

  return (
    <>
      {/* Mobile top bar: section title, back chevron and the bell. The drawer is
          opened from the tab bar's "Más", so no hamburger lives here. */}
      <MobileTopBar />

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 dark:bg-black/60 z-40"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar (Fixed Desktop / Responsive Drawer Mobile) */}
      <aside
        data-sidebar-root
        id="mobile-nav-drawer"
        data-state={isMobileMenuOpen ? "open" : "closed"}
        className={cn(
          "fixed bottom-0 left-0 lg:top-0 lg:bottom-auto lg:h-screen flex flex-col z-50",
          "top-[calc(var(--mobile-header)+var(--safe-top))]",
          "pl-[var(--safe-left)] pr-[var(--safe-right)]",
          "bg-card border-r border-border/80 shadow-lg shadow-black/10 lg:shadow-none",
          "transition-[width,transform] duration-300 ease-in-out",
          "lg:translate-x-0",
          isCollapsed ? "lg:w-[72px]" : "lg:w-[320px]",
          "w-[280px] sm:w-[320px]",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          // Its own snapshot: the rail keeps its place while the page fades.
          "[view-transition-name:app-sidebar]",
        )}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {sidebarContent}
        </div>
      </aside>
    </>
  );
}

