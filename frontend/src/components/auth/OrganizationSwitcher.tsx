"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  Shield,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/auth";

export interface SwitcherOrganization {
  id: string;
  name: string;
  role: AppRole;
  plan: "BASIC" | "PRO";
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED";
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface OrganizationSwitcherProps {
  currentOrganizationId?: string | null;
  onSwitch: (organizationId: string) => Promise<void>;
  isSuperAdmin?: boolean;
  onSelectAll?: () => void;
  /**
   * Where the list opens. The rail's account block sits at the end of the
   * sidebar, so there the list must open upward or it falls off screen.
   */
  placement?: "down" | "up";
  className?: string;
}

const planLabels: Record<string, string> = {
  BASIC: "Básico",
  PRO: "Pro",
};

const roleLabels: Record<string, string> = {
  ADMIN: "Administrador",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
};

const statusLabels: Record<string, string> = {
  TRIAL: "Prueba",
  ACTIVE: "Activo",
  PAST_DUE: "Vencido",
  SUSPENDED: "Suspendido",
};

export function OrganizationSwitcher({
  currentOrganizationId,
  onSwitch,
  isSuperAdmin,
  onSelectAll,
  placement = "down",
  className,
}: OrganizationSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const userQuery = useQuery<{
    organizations: SwitcherOrganization[];
  }>({
    queryKey: ["auth", "organizations"],
    queryFn: () =>
      api
        .get<{ organizations: SwitcherOrganization[] }>("/auth/organizations")
        .then((res) => res.data),
    enabled: !isSuperAdmin,
  });

  const adminQuery = useQuery<AdminOrganization[]>({
    queryKey: ["admin", "organizations"],
    queryFn: () =>
      api
        .get<AdminOrganization[]>("/admin/organizations")
        .then((res) => res.data),
    enabled: !!isSuperAdmin,
  });

  const query = isSuperAdmin ? adminQuery : userQuery;

  /** Trigger row: compact, in the same visual language as the rail's items. */
  function renderTrigger(label: string, name: string, meta?: ReactNode) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label={label}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
          isOpen
            ? "border-border/70 bg-muted/50"
            : "border-transparent hover:border-border/60 hover:bg-muted/40"
        )}
      >
        <Building2
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {name}
          </span>
          {meta && (
            <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-muted-foreground">
              {meta}
            </span>
          )}
        </span>
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
    );
  }

  /**
   * The list owns its scroll and its height cap: a super admin can belong to
   * dozens of organizations, and the rail must not grow with them.
   */
  function renderList(children: ReactNode) {
    return (
      <div
        data-testid="organization-list"
        data-placement={placement}
        className={cn(
          "absolute inset-x-0 z-[60] flex flex-col gap-0.5 rounded-lg border border-border/70 bg-card p-1 shadow-lg",
          "max-h-[min(18rem,45vh)] overflow-y-auto overscroll-contain scrollbar-app",
          placement === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        )}
      >
        {children}
      </div>
    );
  }

  function renderRow({
    id,
    label,
    meta,
    icon,
    selected,
    busy,
    onSelect,
  }: {
    id: string;
    label: string;
    meta?: string;
    icon: ReactNode;
    selected: boolean;
    busy: boolean;
    onSelect: () => void;
  }) {
    return (
      <button
        key={id}
        type="button"
        onClick={onSelect}
        disabled={busy || selected}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          selected
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          busy && "opacity-70"
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {label}
        </span>
        {meta && (
          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
            {meta}
          </span>
        )}
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-text" />
        ) : selected ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-primary-text" />
        ) : null}
      </button>
    );
  }

  if (query.isLoading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[13px] text-muted-foreground",
          className
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Cargando organizaciones…
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        className={cn(
          "rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-[13px] text-danger-text",
          className
        )}
      >
        No se pudieron cargar las organizaciones.
      </div>
    );
  }

  if (!isSuperAdmin) {
    const userOrgs =
      (query.data as { organizations: SwitcherOrganization[] } | undefined)
        ?.organizations ?? [];

    if (userOrgs.length <= 1) {
      return null;
    }

    const currentOrg =
      userOrgs.find((org) => org.id === currentOrganizationId) ?? userOrgs[0];

    const handleSelect = async (organizationId: string) => {
      setSwitchingId(organizationId);
      try {
        await onSwitch(organizationId);
      } finally {
        setSwitchingId(null);
        setIsOpen(false);
      }
    };

    return (
      <div className={cn("relative", className)}>
        {renderTrigger(
          "Cambiar organización",
          currentOrg?.name ?? "",
          currentOrg && (
            <>
              <Shield className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {roleLabels[currentOrg.role] ?? currentOrg.role}
                <span className="text-muted-foreground/60"> · </span>
                {planLabels[currentOrg.plan] ?? currentOrg.plan}
              </span>
            </>
          )
        )}

        {isOpen &&
          renderList(
            userOrgs.map((org) =>
              renderRow({
                id: org.id,
                label: org.name,
                meta: `${roleLabels[org.role] ?? org.role} · ${
                  planLabels[org.plan] ?? org.plan
                }`,
                icon: (
                  <Building2
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                ),
                selected: org.id === currentOrganizationId,
                busy: switchingId === org.id,
                onSelect: () => void handleSelect(org.id),
              })
            )
          )}
      </div>
    );
  }

  const adminOrgs: AdminOrganization[] = (query.data as AdminOrganization[]) ?? [];

  const handleSelectAdmin = async (organizationId: string) => {
    setSwitchingId(organizationId);
    try {
      await onSwitch(organizationId);
    } finally {
      setSwitchingId(null);
      setIsOpen(false);
    }
  };

  const handleSelectAll = () => {
    setIsOpen(false);
    onSelectAll?.();
  };

  const isAllSelected = !currentOrganizationId;
  const selectedOrg = adminOrgs.find((org) => org.id === currentOrganizationId);

  return (
    <div className={cn("relative", className)}>
      {renderTrigger(
        "Seleccionar organización",
        isAllSelected ? "Todas las organizaciones" : selectedOrg?.name ?? "Seleccionar…",
        !isAllSelected &&
          selectedOrg && (
            <>
              <Shield className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {statusLabels[selectedOrg.status] ?? selectedOrg.status}
              </span>
            </>
          )
      )}

      {isOpen &&
        renderList(
          <>
            {renderRow({
              id: "__all__",
              label: "Todas las organizaciones",
              meta: "Global",
              icon: <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
              selected: isAllSelected,
              busy: false,
              onSelect: handleSelectAll,
            })}
            {adminOrgs.map((org) =>
              renderRow({
                id: org.id,
                label: org.name,
                meta: statusLabels[org.status] ?? org.status,
                icon: (
                  <Building2
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                ),
                selected: org.id === currentOrganizationId,
                busy: switchingId === org.id,
                onSelect: () => void handleSelectAdmin(org.id),
              })
            )}
          </>
        )}
    </div>
  );
}
