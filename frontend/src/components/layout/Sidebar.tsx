"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { OrganizationSwitcher } from "@/components/auth/OrganizationSwitcher";
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
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
  },
  {
    label: "POS",
    href: "/pos",
    icon: <ShoppingBasket className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
  },
  {
    label: "Ventas",
    href: "/sales",
    icon: <Receipt className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
  },
  {
    label: "Clientes",
    href: "/customers",
    icon: <Users className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
  },
  {
    label: "Préstamos",
    href: "/loans",
    icon: <HandCoins className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER"],
  },
  {
    label: "Inventario",
    href: "/inventory",
    icon: <Package className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER", "INVENTORY_USER"],
  },
  {
    label: "Categorías",
    href: "/categories",
    icon: <FolderTree className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
  },
  {
    label: "Proveedores",
    href: "/suppliers",
    icon: <Truck className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
  },
  {
    label: "Compras",
    href: "/purchase-orders",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["ADMIN", "INVENTORY_USER"],
  },
  {
    label: "Salidas",
    href: "/expenses",
    icon: <Wallet className="w-4 h-4" />,
    roles: ["ADMIN"],
  },
  {
    label: "Reportes",
    href: "/reports",
    icon: <TrendingUp className="w-4 h-4" />,
    roles: ["ADMIN"],
  },
  {
    label: "Tareas",
    href: "/tasks",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["ADMIN", "CASHIER", "INVENTORY_USER"],
  },
  {
    label: "Mi perfil",
    href: "/profile",
    icon: <UserIcon className="w-4 h-4" />,
  },
  {
    label: "Configuración",
    href: "/settings",
    icon: <Settings className="w-4 h-4" />,
    roles: ["ADMIN"],
  },
  {
    label: "SuperAdmin",
    href: "/admin",
    icon: <Shield className="w-4 h-4" />,
    roles: ["SUPER_ADMIN"],
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
            <span className="text-[#FF9933] underline decoration-[#FF9933] decoration-[3.5px] underline-offset-[6px]">
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

      {/* Block 2: Date + time - es-CO formatting with the 60s live tick */}
      <div
        data-testid="sidebar-clock"
        className={cn("shrink-0", isCollapsed ? "px-2 pt-3" : "px-4 pt-4")}
      >
        <div
          className={cn(
            "font-mono text-muted-foreground text-center bg-muted/60 rounded-lg border border-border/40",
            isCollapsed
              ? "py-1.5 px-1"
              : "text-[11px] py-1.5 px-2"
          )}
          title={`${formattedDate}, ${formattedTime}`}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center justify-center">
              <span className="font-bold text-[11px] font-mono tracking-tight leading-none text-foreground">
                {timeDigits}
              </span>
              {timePeriod && (
                <span className="text-[8px] font-mono font-bold tracking-widest uppercase text-muted-foreground mt-0.5 leading-none">
                  {timePeriod}
                </span>
              )}
              <span className="sr-only">, {formattedDate}</span>
            </div>
          ) : (
            <span className="whitespace-nowrap">
              {formattedDate}, {formattedTime}
            </span>
          )}
        </div>
      </div>

      {/* Block 3: Navigation - role-filtered, active styling, scroll into view */}
      <nav
        data-testid="sidebar-nav"
        ref={navRef}
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain pb-20 lg:pb-3 scrollbar-app",
          isCollapsed ? "px-2 py-3 space-y-2" : "px-3 py-3 space-y-1"
        )}
      >
        {filteredItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

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
                "sidebar-item flex items-center rounded-xl text-xs font-semibold select-none",
                isCollapsed
                  ? "justify-center p-0 w-11 h-11 mx-auto"
                  : "gap-3 px-3.5 py-2.5 w-full",
                isActive
                  ? cn(
                      "active bg-primary-light text-primary relative shadow-xs",
                      !isCollapsed &&
                        "after:absolute after:left-0 after:w-1 after:h-2/3 after:bg-primary after:rounded-r-full",
                      isCollapsed && "ring-1.5 ring-primary/40 font-bold"
                    )
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors duration-100"
              )}
              title={isCollapsed ? item.label : undefined}
            >
              <span
                className={cn(
                  "shrink-0 flex items-center justify-center",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.icon}
              </span>
              <span className={cn("truncate", isCollapsed ? "sr-only" : "inline")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Floating tooltip for collapsed rail items */}
      {isCollapsed && hoveredTooltip && (
        <div
          data-testid="sidebar-rail-tooltip"
          style={{ top: hoveredTooltip.top }}
          className="fixed left-[78px] -translate-y-1/2 z-[70] px-3 py-1.5 rounded-lg bg-foreground text-background dark:bg-card dark:text-foreground text-xs font-semibold shadow-xl border border-border/80 pointer-events-none whitespace-nowrap animate-in fade-in-0 zoom-in-95 duration-150 flex items-center gap-2"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
          <span>{hoveredTooltip.label}</span>
        </div>
      )}

      {/* Block 4: User - avatar, name, role badge, theme toggle and logout */}
      {user && (
        <div
          data-testid="sidebar-user"
          className={cn(
            "border-t border-border/70 shrink-0",
            isCollapsed ? "px-2 py-3" : "px-5 py-4"
          )}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2.5">
              <div
                className="w-10 h-10 rounded-xl bg-primary-light border border-primary/30 text-primary flex items-center justify-center font-bold text-sm shrink-0"
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
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4 text-primary" />
                ) : (
                  <Moon className="w-4 h-4 text-primary" />
                )}
              </button>

              <button
                type="button"
                onClick={logout}
                className="p-2 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                aria-label="Cerrar sesion"
                title="Cerrar sesion"
              >
                <LogOut className="w-4 h-4" />
              </button>

              <div className="border-t border-border/60 pt-2 w-full flex justify-center">
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  aria-label="Cambiar organizacion (expandir)"
                  title="Cambiar organizacion (expandir barra)"
                >
                  <Building2 className="w-4 h-4" />
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
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-light border border-primary/30 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate leading-tight">
                    {user.name}
                  </p>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono text-[10px] font-semibold mt-0.5">
                    {roleLabels[user.role] ?? user.role}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center bg-muted/80 rounded-lg p-0.5 border border-border/40">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label="Cambiar a modo claro"
                    className={cn(
                      "p-1 rounded-md transition-colors",
                      theme === "light"
                        ? "bg-card text-primary shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Sun className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label="Cambiar a modo oscuro"
                    className={cn(
                      "p-1 rounded-md transition-colors",
                      theme === "dark"
                        ? "bg-card text-primary shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Moon className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={logout}
                  className="p-1.5 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                  aria-label="Cerrar sesion"
                  title="Cerrar sesion"
                >
                  <LogOut className="w-4 h-4" />
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
        <div className="flex items-center gap-2.5">
          <Image
            src="/brand/icon-192.png"
            alt={`${APP_NAME} logo`}
            width={192}
            height={192}
            className="w-9 h-9 shrink-0 object-contain drop-shadow-xs"
          />
          <span className="text-lg font-black tracking-tight text-foreground">
            Meper
            <span className="text-[#FF9933] underline decoration-[#FF9933] decoration-2 underline-offset-4">
              POS
            </span>
          </span>
        </div>
        <button
          onClick={toggleMobileMenu}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={isMobileMenuOpen ? "Cerrar menu" : "Abrir menu"}
        >
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
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

