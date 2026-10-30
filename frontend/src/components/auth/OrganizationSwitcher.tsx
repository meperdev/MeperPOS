"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Shield,
  Loader2,
  Globe,
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
}

const planLabels: Record<string, string> = {
  BASIC: "Basico",
  PRO: "Pro",
};

const roleLabels: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
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

  const isLoading = query.isLoading;
  const error = query.error;

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 p-2.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando organizaciones...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
        No se pudieron cargar las organizaciones.
      </div>
    );
  }

  if (!isSuperAdmin) {
    const userOrgs = (query.data as { organizations: SwitcherOrganization[] } | undefined)?.organizations ?? [];

    if (userOrgs.length <= 1) {
      return null;
    }

    const currentOrg =
      userOrgs.find((org) => org.id === currentOrganizationId) ??
      userOrgs[0];

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
      <div className="mt-3">
        <div className="overflow-hidden rounded-xl border border-primary/40 bg-primary/5">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            aria-expanded={isOpen}
            aria-label="Cambiar organizacion"
          >
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Organizacion</p>
              <p className="truncate text-sm font-semibold text-foreground">
                {currentOrg?.name}
              </p>
              {currentOrg && (
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  {roleLabels[currentOrg.role] ?? currentOrg.role}
                  <span className="text-muted-foreground/60">·</span>
                  {planLabels[currentOrg.plan] ?? currentOrg.plan}
                </p>
              )}
            </div>
            {isOpen ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>

          {isOpen && (
            <div className="space-y-1 border-t border-primary/20 p-2">
              {userOrgs.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => void handleSelect(org.id)}
                  disabled={
                    switchingId === org.id || org.id === currentOrganizationId
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    org.id === currentOrganizationId
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border/60 bg-card hover:bg-muted"
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0 text-primary-text" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{org.name}</p>
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      {roleLabels[org.role] ?? org.role}
                      <span className="text-muted-foreground/60">·</span>
                      {planLabels[org.plan] ?? org.plan}
                    </p>
                  </div>
                  {switchingId === org.id && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary-text" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
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

  return (
    <div className="mt-3">
      <div className="overflow-hidden rounded-xl border border-primary/40 bg-primary/5">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          aria-expanded={isOpen}
          aria-label="Seleccionar organizacion"
        >
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Organizacion</p>
            <p className="truncate text-sm font-semibold text-foreground">
              {isAllSelected
                ? "Todas las organizaciones"
                : adminOrgs.find((o) => o.id === currentOrganizationId)?.name ?? "Seleccionar..."}
            </p>
            {!isAllSelected && currentOrganizationId && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                {statusLabels[adminOrgs.find((o) => o.id === currentOrganizationId)?.status ?? ""] ?? "—"}
              </p>
            )}
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {isOpen && (
          <div className="space-y-1 border-t border-primary/20 p-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                isAllSelected
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 bg-card hover:bg-muted"
              )}
            >
              <Globe className="h-4 w-4 shrink-0 text-primary-text" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Todas las organizaciones</p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  Vista global sin filtro
                </p>
              </div>
            </button>

            {adminOrgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => void handleSelectAdmin(org.id)}
                disabled={switchingId === org.id || org.id === currentOrganizationId}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  org.id === currentOrganizationId
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border/60 bg-card hover:bg-muted"
                )}
              >
                <Building2 className="h-4 w-4 shrink-0 text-primary-text" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{org.name}</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Shield className="h-3 w-3" />
                    {statusLabels[org.status] ?? org.status}
                    <span className="text-muted-foreground/60">·</span>
                    {planLabels[org.plan] ?? org.plan}
                  </p>
                </div>
                {switchingId === org.id && (
                  <Loader2 className="h-4 w-4 animate-spin text-primary-text" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
