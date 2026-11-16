import {
  LayoutDashboard,
  ShoppingBasket,
  Package,
  Users,
  Shield,
  TrendingUp,
  FolderTree,
  Receipt,
  ClipboardList,
  Truck,
  Wallet,
  Banknote,
  HandCoins,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { hasAnyRole, type AppRole } from "@/lib/auth";

/**
 * The authenticated app's navigation map: one list that the desktop rail, the
 * mobile drawer and the mobile tab bar all read, so a section can never carry a
 * different label or a different audience depending on where it is painted.
 *
 * Not to be confused with `DashboardLayout`'s route gate, which answers "may
 * this role be on this path at all" and also covers paths that never appear in
 * navigation (users, alerts, settings). This map answers "is this item shown".
 */
export interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: AppRole[];
  /** Section header shown above the item when the rail is expanded. */
  group: string;
}

/** Owners and administrators only, matched by identity rather than by role list. */
export const OWNER_ADMIN_ONLY_ROUTES = ["/employees", "/payroll"];

export const navItems: NavItem[] = [
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

/**
 * Sections that have a screen but no navigation row, labelled the way the mobile
 * top bar names them. The account menu words its own destinations in
 * `accountMenuSections` below; both point at the same paths.
 */
const sectionLabels: Record<string, string> = {
  "/settings": "Configuración",
  "/profile": "Mi perfil",
  "/alerts": "Alertas",
  "/users": "Usuarios",
};

/**
 * Destinations of the account menu, in the order the menu paints them.
 *
 * The roles are the audience `DashboardLayout`'s route gate admits on the same
 * path: the menu is display only — every endpoint behind a destination is
 * guarded on the server — but a row the gate would bounce is noise, so both
 * sides read the same lists.
 */
export interface AccountMenuSection {
  href: string;
  label: string;
  roles: AppRole[];
}

export const accountMenuSections: AccountMenuSection[] = [
  {
    href: "/profile",
    label: "Mi perfil",
    roles: ["ADMIN", "CASHIER", "INVENTORY_USER"],
  },
  {
    href: "/alerts",
    label: "Historial de alertas",
    roles: ["ADMIN", "INVENTORY_USER"],
  },
  { href: "/settings", label: "Configuración", roles: ["ADMIN"] },
];

export function visibleAccountMenuSections(
  userRole: AppRole | string | undefined,
): AccountMenuSection[] {
  return accountMenuSections.filter((section) =>
    hasAnyRole(userRole, section.roles),
  );
}

export function canOpenNavItem(
  userRole: AppRole | string | undefined,
  item: NavItem,
): boolean {
  if (OWNER_ADMIN_ONLY_ROUTES.includes(item.href)) {
    return userRole === "OWNER" || userRole === "ADMIN";
  }
  return !item.roles || hasAnyRole(userRole, item.roles);
}

export function filterNavItems(
  userRole: AppRole | string | undefined,
): NavItem[] {
  return navItems.filter((item) => canOpenNavItem(userRole, item));
}

/**
 * A section is active for its own path and for everything under it, except the
 * dashboard, whose path is the root of the app rather than a prefix of others.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(`${href}/`))
  );
}

/** The first path segment, e.g. `/sales/abc` -> `/sales`. */
export function sectionHref(pathname: string): string {
  const [, first] = pathname.split("/");
  return first ? `/${first}` : "/";
}

/** The label the rail uses for the current section, for the mobile top bar. */
export function resolveSectionLabel(pathname: string): string {
  const href = sectionHref(pathname);
  const item = navItems.find((candidate) => candidate.href === href);
  return item?.label ?? sectionLabels[href] ?? APP_NAME;
}

/** Drops the last segment: `/sales/abc` -> `/sales`, `/sales` -> `/`. */
export function parentPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : trimmed.slice(0, lastSlash);
}

/** True when the path is below a section root, i.e. a detail or creation page. */
export function isNestedPath(pathname: string): boolean {
  return parentPath(pathname) !== "/";
}

export interface MobileTab {
  href: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * Five icons is the most a phone bar carries comfortably, so the four daily
 * sections get a tab and everything else stays behind "Más". The label and the
 * audience come from `navItems`: a tab is a shortcut into the rail, never a
 * second map of it.
 */
const MOBILE_TAB_ICONS: Record<string, React.ReactNode> = {
  "/dashboard": <LayoutDashboard className="h-5 w-5" />,
  "/pos": <ShoppingBasket className="h-5 w-5" />,
  "/sales": <Receipt className="h-5 w-5" />,
  "/inventory": <Package className="h-5 w-5" />,
};

const MOBILE_TAB_ORDER = ["/dashboard", "/pos", "/sales", "/inventory"];

export function mobileTabsFor(
  userRole: AppRole | string | undefined,
): MobileTab[] {
  const visible = filterNavItems(userRole);
  return MOBILE_TAB_ORDER.flatMap((href) => {
    const item = visible.find((candidate) => candidate.href === href);
    return item ? [{ href, label: item.label, icon: MOBILE_TAB_ICONS[href] }] : [];
  });
}
