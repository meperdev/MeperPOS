"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useOrganizationModules, useUpdateOrganizationModule } from "@/hooks/useAdmin";

export function OrganizationModulesCard({ organizationId }: { organizationId: string }) {
  const modules = useOrganizationModules(organizationId);
  const update = useUpdateOrganizationModule();
  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Módulos</h3></CardHeader>
      <CardContent className="space-y-3">
        {modules.isLoading && <p>Cargando módulos...</p>}
        {modules.isError && <p role="alert">No se pudieron cargar los módulos.</p>}
        {modules.data?.map((module) => (
          <div key={module.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{module.name}</p>
              <p className="text-xs text-muted-foreground">
                {module.enabled ? "Activo" : "Inactivo"} · {module.description}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${module.enabled ? "Desactivar" : "Activar"} ${module.name}`}
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ id: organizationId, moduleId: module.id, enabled: !module.enabled })
              }
            >
              {module.enabled ? "Desactivar" : "Activar"}
            </Button>
          </div>
        ))}
        {update.isError && <p role="alert">No se pudo actualizar el módulo.</p>}
      </CardContent>
    </Card>
  );
}
