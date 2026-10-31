"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/contexts/ToastContext";
import { useCreateEmployeeShift, useEmployeeShifts, type ShiftKind } from "@/hooks/useEmployeeShifts";
import type { Employee } from "@/hooks/useEmployees";
import { getApiErrorMessage } from "@/lib/api";
import { EmployeeDialog } from "./EmployeeDialog";

export function ShiftDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const shifts = useEmployeeShifts(employee.id, true);
  const create = useCreateEmployeeShift();
  const toast = useToast();
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<ShiftKind>("FULL_DAY");
  const [amount, setAmount] = useState("");
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!employee.active || saving) return;
    setSaving(true);
    try {
      await create.mutateAsync({ employeeId: employee.id, date, kind, amount: Number(amount), ...(observation.trim() ? { observation: observation.trim() } : {}) });
      toast.success("Jornada registrada"); setDate(""); setAmount(""); setObservation("");
    } catch (error) { toast.error(getApiErrorMessage(error, "No se pudo registrar la jornada")); }
    finally { setSaving(false); }
  }
  return <EmployeeDialog title={`Jornadas de ${employee.name}`} onClose={() => { if (!saving) onClose(); }}>
    <div className="space-y-4">
      {shifts.isLoading ? <p>Cargando jornadas...</p> : shifts.isError ? <div role="alert"><p>No se pudieron cargar las jornadas</p><Button variant="outline" onClick={() => void shifts.refetch()}>Reintentar</Button></div> : !shifts.data?.length ? <p>No hay jornadas registradas</p> : <ul className="space-y-2">{shifts.data.map((shift) => <li key={shift.id} className="rounded-xl border border-border p-3 text-sm"><p>{shift.date.slice(0, 10)} · {shift.kind === "FULL_DAY" ? "Día completo" : "Día parcial"} · {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(shift.amount))}</p>{shift.observation && <p>{shift.observation}</p>}</li>)}</ul>}
      {employee.active ? <form onSubmit={submit}>
        <fieldset disabled={saving} className="grid gap-3">
        <Input label="Fecha" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="text-xs font-semibold uppercase text-muted-foreground">Tipo de jornada<select className="mt-1.5 w-full rounded-xl border border-border bg-card p-3 text-foreground" value={kind} onChange={(e) => setKind(e.target.value as ShiftKind)}><option value="FULL_DAY">Día completo</option><option value="PARTIAL_DAY">Día parcial</option></select></label>
        <Input label="Valor" type="number" required min="0.01" max="9999999999.99" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Observación (opcional)" value={observation} onChange={(e) => setObservation(e.target.value)} />
        <div><Button type="submit" disabled={saving}>Registrar jornada</Button></div>
        </fieldset>
      </form> : <p className="text-sm text-muted-foreground">Activa al empleado para registrar jornadas.</p>}
    </div>
  </EmployeeDialog>;
}
