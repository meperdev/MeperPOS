"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { OrganizationSwitcher } from "@/components/auth/OrganizationSwitcher";
import { AlertCenter } from "@/components/layout/AlertCenter";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
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
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  HandCoins,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn, safeGetItem, safeSetItem, safeRemoveItem } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { hasAnyRole, type AppRole } from "@/lib/auth";
import { useState, useCallback, useEffect, useRef } from "react";

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
    label: "Dashboard",
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
    label: "Préstamos",
    href: "/loans",
    icon: <HandCoins className="w-4 h-4" />,
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
    label: "Tareas",
    href: "/tasks",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER", "INVENTORY_USER"],
    group: "Equipo",
  },
  {
    label: "Mi perfil",
    href: "/profile",
    icon: <UserIcon className="w-4 h-4" />,
    group: "Cuenta",
  },
  {
    label: "Configuración",
    href: "/settings",
    icon: <Settings className="w-4 h-4" />,
    roles: ["ADMIN"],
    group: "Cuenta",
  },
  {
    label: "SuperAdmin",
    href: "/admin",
    icon: <Shield className="w-4 h-4" />,
    roles: ["SUPER_ADMIN"],
    group: "Cuenta",
  },
];

const roleLabels: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
};

/**
 * Applies a SuperAdmin organization scope change.
 *
 * A scope change must RESET the queries: not clear them, and not merely
 * invalidate them.
 *
 * - Invalidating leaves the previous organization's rows readable while the
 *   refetch resolves.
 * - Clearing empties the cache but leaves a MOUNTED observer holding its last
 *   result, and unlike invalidating it requests no refetch at all, so those rows
 *   can stay on screen indefinitely.
 *
 * `resetQueries` drops the displayed state AND refetches the active queries,
 * which is also how the switcher's own organization list comes back.
 */
export function applyOrganizationScope(
  queryClient: QueryClient,
  organizationId: string | null
): void {
  if (organizationId) {
    safeSetItem(SELECTED_ORGANIZATION_KEY, organizationId);
  } else {
    safeRemoveItem(SELECTED_ORGANIZATION_KEY);
  }
  void queryClient.resetQueries();
}

export function Sidebar() {
  const pathname = usePathname();
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

  const filteredItems = navItems.filter(
    (item) => !item.roles || (user && hasAnyRole(user.role, item.roles))
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

  // Scroll the active nav item into view only if it is actually hidden outside the viewport
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const activeLink = nav.querySelector<HTMLElement>(".sidebar-item.active");
    if (!activeLink) return;

    const navRect = nav.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const isOutOfView = linkRect.top < navRect.top || linkRect.bottom > navRect.bottom;

    if (isOutOfView && activeLink.scrollIntoView) {
      activeLink.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [pathname]);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  const formattedDate = new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const formattedTime = new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const timeMatch = formattedTime.match(/^(\d{1,2}:\d{2})\s*(.*)$/);
  const timeDigits = timeMatch ? timeMatch[1] : formattedTime;
  const timePeriod = timeMatch && timeMatch[2]
    ? timeMatch[2].replace(/[\.\s]/g, "").toUpperCase()
    : "";

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
              "text-[30px] font-black text-foreground truncate leading-none tracking-tight",
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
          className="hidden lg:flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          aria-label={isCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
          title={isCollapsed ? "Expandir barra lateral (Ctrl+B)" : "Colapsar barra lateral (Ctrl+B)"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Block 2: Date + time and the persistent alert bell */}
      <div
        data-testid="sidebar-clock"
        className={cn("shrink-0", isCollapsed ? "px-2 pt-3" : "px-3 pt-3")}
      >
        <div
          className={cn(
            "flex items-center gap-2",
            isCollapsed ? "flex-col" : "justify-between",
          )}
        >
          <div
            className={cn(
              "flex items-center rounded-md border border-border/60 bg-muted/30 px-2 py-1.5",
              isCollapsed
                ? "w-full justify-center"
                : "min-w-0 flex-1 justify-between gap-2",
            )}
            title={`${formattedDate}, ${formattedTime}`}
          >
            {isCollapsed ? (
              <div className="flex flex-col items-center leading-none">
                <span className="font-mono text-[11px] font-semibold text-foreground tabular-nums">
                  {timeDigits}
                </span>
                {timePeriod && (
                  <span className="mt-0.5 font-mono text-[9px] text-muted-foreground leading-none">
                    {timePeriod}
                  </span>
                )}
                <span className="sr-only">, {formattedDate}</span>
              </div>
            ) : (
              <>
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formattedDate}
                </span>
                <span className="shrink-0 font-mono text-[11px] font-semibold text-foreground tabular-nums">
                  {timeDigits} {timePeriod}
                </span>
              </>
            )}
          </div>

          <AlertCenter
            collapsed={isCollapsed}
            className="hidden lg:inline-flex shrink-0"
          />
        </div>
      </div>

      {/* Block 3: Navigation - role-filtered, active styling, scroll into view */}
      <nav
        data-testid="sidebar-nav"
        ref={navRef}
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain pb-20 lg:pb-3 scrollbar-app",
          isCollapsed ? "px-2 py-3" : "px-3 py-3"
        )}
      >
        {navGroups.map((group, groupIndex) => (
          <div
            key={group.label}
            className={groupIndex > 0 ? (isCollapsed ? "mt-2" : "mt-4") : undefined}
          >
            {!isCollapsed && (
              <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
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
                        : "h-11 w-full gap-2.5 px-2 lg:h-9",
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

      {/* Block 4: User - avatar, name, role badge, theme toggle and logout */}
      {user && (
        <div
          data-testid="sidebar-user"
          className={cn(
            "border-t border-border/70 shrink-0",
            isCollapsed ? "px-2 py-3" : "px-3 py-3"
          )}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 font-mono text-[11px] font-semibold text-foreground"
                title={`${user.name} (${roleLabels[user.role] ?? user.role})`}
              >
                {initials}
                <span className="sr-only">
                  {user.name} ({roleLabels[user.role] ?? user.role})
                </span>
              </div>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={
                  theme === "dark"
                    ? "Cambiar a modo claro"
                    : "Cambiar a modo oscuro"
                }
                title={
                  theme === "dark"
                    ? "Cambiar a modo claro"
                    : "Cambiar a modo oscuro"
                }
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:h-8 lg:w-8"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              <button
                type="button"
                onClick={logout}
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 lg:h-8 lg:w-8"
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
              >
                <LogOut className="h-4 w-4" />
              </button>

              <div className="w-full border-t border-border/60 pt-1.5 flex justify-center">
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:h-8 lg:w-8"
                  aria-label="Cambiar organizacion (expandir)"
                  title="Cambiar organizacion (expandir barra)"
                >
                  <Building2 className="h-4 w-4" />
                </button>
              </div>

              <div className="hidden">
                {user.isSuperAdmin ? (
                  <OrganizationSwitcher
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
                    currentOrganizationId={user.organizationId ?? undefined}
                    onSwitch={switchOrganization}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 font-mono text-[11px] font-semibold text-foreground">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold leading-tight text-foreground">
                    {user.name}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {roleLabels[user.role] ?? user.role}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={
                    theme === "dark"
                      ? "Cambiar a modo claro"
                      : "Cambiar a modo oscuro"
                  }
                  title={
                    theme === "dark"
                      ? "Cambiar a modo claro"
                      : "Cambiar a modo oscuro"
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  {theme === "dark" ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                  aria-label="Cerrar sesión"
                  title="Cerrar sesión"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>

              {user.isSuperAdmin ? (
                <OrganizationSwitcher
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
                  currentOrganizationId={user.organizationId ?? undefined}
                  onSwitch={switchOrganization}
                />
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-4 bg-card border-b border-border">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            onClick={toggleMobileMenu}
            className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={isMobileMenuOpen ? "Cerrar menu" : "Abrir menu"}
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
          <span className="truncate text-lg font-black tracking-tight text-foreground">
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
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-xs z-40"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar (Fixed Desktop / Responsive Drawer Mobile) */}
      <aside
        data-sidebar-root
        className={cn(
          "fixed top-14 bottom-0 left-0 lg:top-0 lg:bottom-auto lg:h-screen flex flex-col z-50",
          "bg-card border-r border-border/80 shadow-2xl lg:shadow-none",
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

