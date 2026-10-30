"use client";

import { Building2, Shield, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Organization {
  id: string;
  name: string;
  role: string;
  plan: string;
}

interface OrganizationSelectModalProps {
  organizations: Organization[];
  onSelect: (organizationId: string) => void;
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

export function OrganizationSelectModal({
  organizations,
  onSelect,
}: OrganizationSelectModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={cn(
          "relative w-full max-w-md overflow-hidden rounded-xl border border-border/60",
          "bg-card shadow-2xl shadow-black/30 animate-fade-in-up"
        )}
      >
        <div className="border-b border-border/60 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            Selecciona una organizacion
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu cuenta pertenece a multiples organizaciones. Elige una para continuar.
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3 scrollbar-hide">
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => onSelect(org.id)}
              className={cn(
                "w-full flex items-center gap-4 rounded-lg border border-border/60 p-4",
                "bg-card text-left transition-colors hover:bg-muted/60 hover:border-primary/40",
                "focus:outline-none focus:ring-2 focus:ring-primary/50"
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
                <Building2 className="h-5 w-5" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {org.name}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    {roleLabels[org.role] || org.role}
                  </span>
                </div>
              </div>

              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  org.plan === "PRO"
                    ? "bg-terracotta/10 text-terracotta border border-terracotta/20"
                    : "bg-muted text-muted-foreground border border-border"
                )}
              >
                <Crown className="h-3 w-3" />
                {planLabels[org.plan] || org.plan}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
