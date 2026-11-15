"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useCreateCustomerVehicle, useCustomerVehicles, useUpdateCustomerVehicle } from "@/hooks/useCustomerVehicles";
import { getApiErrorMessage } from "@/lib/api";

export function CustomerVehicles({ customerId }: { customerId: string }) {
  const { data: vehicles, isLoading, isError } = useCustomerVehicles(customerId);
  const create = useCreateCustomerVehicle();
  const update = useUpdateCustomerVehicle();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [plate, setPlate] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");

  async function addVehicle() {
    if (!plate.trim()) {
      setError("Ingresa una placa.");
      return;
    }
    try {
      setError("");
      if (editingId) {
        await update.mutateAsync({ customerId, vehicleId: editingId, plate: plate.trim(), model: model.trim() });
      } else {
        await create.mutateAsync({ customerId, plate: plate.trim(), ...(model.trim() ? { model: model.trim() } : {}) });
      }
      setEditingId(null);
      setPlate("");
      setModel("");
    } catch (cause) {
      setError(getApiErrorMessage(cause, "No se pudo agregar el vehículo."));
    }
  }

  return (
    <section className="space-y-3 border-t border-border/60 pt-4">
      <h3 className="text-sm font-medium">Vehículos</h3>
      {isLoading && <p className="text-sm">Cargando vehículos...</p>}
      {isError && <p role="alert">No se pudieron cargar los vehículos.</p>}
      {vehicles && <ul className="space-y-1 text-sm">{vehicles.map((vehicle) => <li key={vehicle.id} className="flex items-center justify-between gap-2"><span>{vehicle.plate}{vehicle.model ? ` · ${vehicle.model}` : ""}</span><Button type="button" size="sm" variant="ghost" aria-label={`Editar ${vehicle.plate}`} onClick={() => { setEditingId(vehicle.id); setPlate(vehicle.plate); setModel(vehicle.model ?? ""); }}>Editar</Button></li>)}</ul>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Placa" value={plate} onChange={(event) => setPlate(event.target.value)} maxLength={40} />
        <Input label="Modelo" value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} />
      </div>
      {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={addVehicle} loading={create.isPending || update.isPending}>{editingId ? "Guardar vehículo" : "Agregar vehículo"}</Button>
        {editingId && <Button type="button" variant="ghost" onClick={() => { setEditingId(null); setPlate(""); setModel(""); setError(""); }}>Cancelar edición</Button>}
      </div>
    </section>
  );
}
