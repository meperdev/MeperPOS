"use client";

import { useState } from "react";
import { CalendarClock, History } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency, formatDate, toFiniteNumber } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api";
import {
  useCreateEmployeeShift,
  useEmployeeShifts,
  type ShiftKind,
} from "@/hooks/useEmployeeShifts";
import type { Employee } from "@/hooks/useEmployees";

const KIND_LABELS: Record<ShiftKind, string> = {
  FULL_DAY: "Día completo",
  PARTIAL_DAY: "Día parcial",
};

const KIND_OPTIONS = [
  { value: "FULL_DAY", label: KIND_LABELS.FULL_DAY },
  { value: "PARTIAL_DAY", label: KIND_LABELS.PARTIAL_DAY },
];

/**
 * Shift history plus the form that adds one. The history is the reason the
 * dialog opens, so it is the first thing shown and it keeps its own states.
 */
export function ShiftDialog({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
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
      await create.mutateAsync({
        employeeId: employee.id,
        date,
        kind,
        amount: Number(amount),
        ...(observation.trim() ? { observation: observation.trim() } : {}),
      });
      toast.success("Jornada registrada");
      setDate("");
      setAmount("");
      setObservation("");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo registrar la jornada"));
    } finally {
      setSaving(false);
    }
  }

  const list = shifts.data ?? [];

  return (
    <Modal
      isOpen
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`Jornadas de ${employee.name}`}
      size="lg"
      footer={
        employee.active ? (
          <div className="flex justify-end">
            <Button type="submit" form="shift-form" loading={saving}>
              Registrar jornada
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Activa al empleado para registrar jornadas.
          </p>
        )
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <header className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Historial
            </h3>
            {!shifts.isLoading && !shifts.isError && list.length > 0 && (
              <Badge variant="default">
                {list.length} {list.length === 1 ? "jornada" : "jornadas"}
              </Badge>
            )}
          </header>

          {shifts.isLoading ? (
            <div role="status" className="space-y-2">
              <span className="sr-only">Cargando jornadas...</span>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-14 animate-pulse rounded-lg border border-border/70 bg-muted/40"
                  style={{ animationDelay: `${row * 60}ms` }}
                />
              ))}
            </div>
          ) : shifts.isError ? (
            <ErrorState
              message="No se pudieron cargar las jornadas"
              retryLabel="Reintentar"
              onRetry={() => void shifts.refetch()}
            />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-5 w-5 text-muted-foreground" />}
              title="Sin jornadas registradas"
              subtitle="La primera jornada que registres aparecerá aquí"
            />
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
              {list.map((shift) => (
                <li key={shift.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">
                      {formatDate(shift.date)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {KIND_LABELS[shift.kind as ShiftKind] ?? shift.kind}
                    </p>
                  </div>
                  <p className="font-mono text-xs font-semibold text-foreground tabular-nums">
                    {formatCurrency(toFiniteNumber(shift.amount))}
                  </p>
                  {shift.observation && (
                    <p className="w-full text-[11px] text-muted-foreground">
                      {shift.observation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {employee.active && (
          <form id="shift-form" onSubmit={submit}>
            <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Fecha"
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <Select
                label="Tipo de jornada"
                options={KIND_OPTIONS}
                value={kind}
                onChange={(event) => setKind(event.target.value as ShiftKind)}
              />
              <Input
                label="Valor"
                type="number"
                inputMode="decimal"
                required
                min="0.01"
                max="9999999999.99"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <Input
                label="Observación (opcional)"
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
              />
            </fieldset>
          </form>
        )}
      </div>
    </Modal>
  );
}
