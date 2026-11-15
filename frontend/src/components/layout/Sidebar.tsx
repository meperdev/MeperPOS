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
  LayoutDashboard,
  ShoppingBasket,
  Package,
  Users,
  Shield,
  TrendingUp,
  FolderTree,
  Receipt,
  Settings,
  LogOut,
  Moon,
  Sun,
  User as UserIcon,
  Menu,
  X,
  ClipboardList,
  Truck,
  Wallet,
  Banknote,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  HandCoins,
  MoreVertical,
} from "lucide-react";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { formatSidebarClock } from "@/components/layout/sidebar-clock";
import { useTheme } from "@/contexts/ThemeContext";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn, safeGetItem, safeSetItem } from "@/lib/utils";
import { APP_NAME, RAIL_FLYOUT_GAP } from "@/lib/constants";
import { hasAnyRole, type AppRole } from "@/lib/auth";
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Rail scroll offset, kept across the session shell remounting around it. */
export const SIDEBAR_SCROLL_KEY = "meper_sidebar_scroll_top";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: AppRole[];
  /** Section header shown above the item when the rail is expanded. */
  group: string;
}

const navItems: NavItem[] = [
  {
    label: "Panel",
    href: "/dashboard",
    icon: <LayoutDashboard className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
    group: "Operación",
  },
  {
    label: "POS",
    href: "/pos",
    icon: <ShoppingBasket className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
    group: "Operación",
  },
  {
    label: "Ventas",
    href: "/sales",
    icon: <Receipt className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
    group: "Operación",
  },
  {
    label: "Clientes",
    href: "/customers",
    icon: <Users className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
    group: "Operación",
  },
  {
    label: "Inventario",
    href: "/inventory",
    icon: <Package className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER", "INVENTORY_USER"],
    group: "Inventario",
  },
  {
    label: "Categorías",
    href: "/categories",
    icon: <FolderTree className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
    group: "Inventario",
  },
  {
    label: "Proveedores",
    href: "/suppliers",
    icon: <Truck className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
    group: "Inventario",
  },
  {
    label: "Compras",
    href: "/purchase-orders",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
    group: "Inventario",
  },
  {
    label: "Salidas",
    href: "/expenses",
    icon: <Wallet className="w-4 h-4" />,
    roles: ["ADMIN"],
    group: "Finanzas",
  },
  {
    label: "Reportes",
    href: "/reports",
    icon: <TrendingUp className="w-4 h-4" />,
    roles: ["ADMIN"],
    group: "Finanzas",
  },
  {
    label: "Préstamos",
    href: "/loans",
    icon: <HandCoins className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
    group: "Finanzas",
  },
  {
    label: "Empleados",
    href: "/employees",
    icon: <Users className="w-4 h-4" />,
    roles: ["ADMIN"],
    group: "Equipo",
  },
  {
    label: "Nómina",
    href: "/payroll",
    icon: <Banknote className="w-4 h-4" />,
    roles: ["ADMIN"],
    group: "Equipo",
  },
  {
    label: "Tareas",
    href: "/tasks",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER", "INVENTORY_USER"],
    group: "Equipo",
  },
  {
    label: "SuperAdmin",
    href: "/admin",
    icon: <Shield className="w-4 h-4" />,
    roles: ["SUPER_ADMIN"],
    group: "Administración",
  },
];

// Owners and administrators only. These routes are checked by identity instead of
// the inherited role list, so a SUPER_ADMIN scope never reaches tenant payroll.
const OWNER_ADMIN_ONLY_ROUTES = ["/employees", "/payroll"];

const roleLabels: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
};

// Footer actions are frameless icon buttons: the bell and the ⋮ menu are the
// only chrome the account area keeps, so they share one treatment.
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<{
    label: string;
    top: number;
  } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const navRef = useRef<HTMLElement>(null);
  const hasRestoredScrollRef = useRef(false);
  const restoredScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });

  const filteredItems = navItems.filter(
    (item) => OWNER_ADMIN_ONLY_ROUTES.includes(item.href)
      ? user?.role === "OWNER" || user?.role === "ADMIN"
      : !item.roles || (user && hasAnyRole(user.role, item.roles))
  );

  // Consecutive items sharing a group collapse into one labelled block, so the
  // approved operational order survives while the rail gains a scannable spine.
  const navGroups = filteredItems.reduce<
    Array<{ label: string; items: NavItem[] }>
  >((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) {
      last.items.push(item);
    } else {
      groups.push({ label: item.group, items: [item] });
    }
    return groups;
  }, []);

  const toggleMobileMenu = useCallback(() => setIsMobileMenuOpen((p) => !p), []);
  const closeMobileMenu = useCallback(() => setIsMobileMenuOpen(false), []);

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

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

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
        router.push("/profile");
      },
    },
    ...(canSeeSettings
      ? [
          {
            label: "Configuración",
            icon: <Settings className="h-3.5 w-3.5" aria-hidden="true" />,
            onSelect: () => {
              closeMobileMenu();
              router.push("/settings");
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

  const clockLabel = formatSidebarClock(now);
  const clockIso = now.toISOString();

  const sidebarContent = (
    <>
      {/* Block 1: Brand - logo and wordmark sized to read as one lockup */}
      <div
        data-testid="sidebar-brand"
        className={cn(
          "border-b border-border/70 shrink-0",
          isCollapsed
            ? "px-2 py-4 flex flex-col items-center gap-3"
            : "px-5 py-5 flex items-center justify-between gap-3"
        )}
      >
        <div className={cn("flex items-center gap-3.5 min-w-0", isCollapsed && "justify-center")}>
          <Image
            src="/brand/icon-192.png"
            alt={`${APP_NAME} logo`}
            width={192}
            height={192}
            className={cn(
              "shrink-0 object-contain drop-shadow-xs",
              isCollapsed ? "w-11 h-11" : "w-14 h-14"
            )}
          />
          <p
            className={cn(
              "text-[30px] font-bold text-foreground truncate leading-none tracking-tight",
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
              className={groupIndex > 0 ? (isCollapsed ? "mt-2" : "mt-4") : undefined}
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
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/dashboard" &&
                      pathname.startsWith(`${item.href}/`));
  
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => {
                        closeMobileMenu();
                        setHoveredTooltip(null);
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
              <time
                data-testid="sidebar-clock"
                dateTime={clockIso}
                className="truncate text-xs tabular-nums text-muted-foreground"
              >
                {clockLabel}
              </time>

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
      {/* Mobile Header */}
      {/*
        Height grows by the top inset instead of letting the notch sit on the
        controls, and the drawer below starts exactly where this ends.
      */}
      <header
        className={cn(
          "lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between",
          "bg-card border-b border-border",
          "h-[calc(var(--mobile-header)+var(--safe-top))] pt-[var(--safe-top)]",
          "pl-[calc(1rem+var(--safe-left))] pr-[calc(1rem+var(--safe-right))]"
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            onClick={toggleMobileMenu}
            className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={isMobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Image
            src="/brand/icon-192.png"
            alt={`${APP_NAME} logo`}
            width={192}
            height={192}
            className="w-9 h-9 shrink-0 object-contain drop-shadow-xs"
          />
          <span className="truncate text-lg font-bold tracking-tight text-foreground">
            Meper
            <span className="text-[#B45309] underline decoration-[#B45309] decoration-2 underline-offset-4 dark:text-[#FF9933] dark:decoration-[#FF9933]">
              POS
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <AlertCenter className="lg:hidden" />
        </div>
      </header>

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
        className={cn(
          "fixed bottom-0 left-0 lg:top-0 lg:bottom-auto lg:h-screen flex flex-col z-50",
          "top-[calc(var(--mobile-header)+var(--safe-top))]",
          "pl-[var(--safe-left)] pr-[var(--safe-right)]",
          "bg-card border-r border-border/80 shadow-lg shadow-black/10 lg:shadow-none",
          "transition-[width,transform] duration-300 ease-in-out",
          "lg:translate-x-0",
          isCollapsed ? "lg:w-[72px]" : "lg:w-[320px]",
          "w-[280px] sm:w-[320px]",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {sidebarContent}
        </div>
      </aside>
    </>
  );
}

