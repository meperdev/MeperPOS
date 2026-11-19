"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { useOrganizationModules } from "@/hooks/useAdmin";

/**
 * Read-only summary of the modules the server reports for this organization.
 *
 * Activation lives in SuperAdmin > Módulos, one control surface for one piece
 * of state. Keeping this card linked instead of interactive means the two
 * surfaces cannot disagree about an operation that writes the same record.
 */
export function OrganizationModulesCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const modules = useOrganizationModules(organizationId);
  const catalog = modules.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">Módulos</h3>
          <Link
            href="/admin/modules"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Administrar módulos
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {modules.isLoading && (
          <p className="text-[13px] text-muted-foreground">Cargando módulos…</p>
        )}

        {modules.isError && (
          <div role="alert" className="space-y-2">
            <p className="text-[13px] text-muted-foreground">
              No se pudieron cargar los módulos.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => modules.refetch()}
            >
              Reintentar
            </Button>
          </div>
        )}

        {!modules.isLoading && !modules.isError && catalog.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No hay módulos disponibles para esta organización.
          </p>
        )}

        {catalog.length > 0 && (
          <ul className="divide-y divide-border/60">
            {catalog.map((module) => (
              <li key={module.id}>
                <Link
                  href={`/admin/modules/${module.id}`}
                  className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground transition-colors duration-150 group-hover:text-primary">
                      {module.name}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">
                      {module.description}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={module.enabled ? "success" : "default"}
                      dot
                    >
                      {module.enabled ? "Activo" : "Inactivo"}
                    </Badge>
                    <ChevronRight
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
