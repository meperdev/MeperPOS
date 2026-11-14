"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useOrganizationVehiclesModule, useUpdateOrganizationVehiclesModule } from "@/hooks/useAdmin";

export function OrganizationModulesCard({ organizationId }: { organizationId: string }) {
  const vehiclesModule = useOrganizationVehiclesModule(organizationId);
  const update = useUpdateOrganizationVehiclesModule();
  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Módulos</h3></CardHeader>
      <CardContent className="space-y-3">
        {vehiclesModule.isLoading && <p>Cargando módulos...</p>}
        {vehiclesModule.isError && <p role="alert">No se pudieron cargar los módulos.</p>}
        {vehiclesModule.data && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Vehículos</p>
              <p className="text-xs text-muted-foreground">{vehiclesModule.data.enabled ? "Activo" : "Inactivo"}</p>
            </div>
            <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ id: organizationId, enabled: !vehiclesModule.data.enabled })}>
              {vehiclesModule.data.enabled ? "Desactivar" : "Activar"}
            </Button>
          </div>
        )}
        {update.isError && <p role="alert">No se pudo actualizar el módulo.</p>}
      </CardContent>
    </Card>
  );
}
