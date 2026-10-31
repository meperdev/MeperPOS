"use client";

import { useMemo, useState } from "react";
import { Lock, Plus, Wallet } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  FilterBar,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import {
  usePayrollObligations,
  type PayrollInstallment,
  type PayrollObligation,
} from "@/hooks/usePayroll";
import {
  CashReturnDialog,
  CorrectionDialog,
  CreatePaymentDialog,
  InstallmentDialog,
  ReplacementPaymentDialog,
} from "./dialogs";
import { ObligationCard } from "./ObligationCard";
import { sumServerAmounts } from "./format";

type PayrollFilter = "all" | "pending" | "completed" | "shifts";

// The segmented filter is the one view control of the list: the three states a
// payment can be read in, plus the payments paid by shifts.
const FILTERS: ReadonlyArray<{ value: PayrollFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "completed", label: "Completados" },
  { value: "shifts", label: "Por jornadas" },
];

// One discriminant for every dialog instead of one flag per dialog, so a dialog
// can never be open twice and closing is a single assignment.
type DialogState =
  | { kind: "create" }
  | { kind: "installment"; obligation: PayrollObligation }
  | { kind: "correction"; obligation: PayrollObligation }
  | {
      kind: "return";
      obligation: PayrollObligation;
      installment: PayrollInstallment;
    }
  | { kind: "replacement"; obligation: PayrollObligation };

export default function PayrollPage() {
  const { user } = useAuth();
  // S5: payroll belongs to owners and administrators only. The route map and the
  // sidebar hide it from every other role; the API enforces the same rule.
  const allowed = user?.role === "OWNER" || user?.role === "ADMIN";
  const obligations = usePayrollObligations(allowed);
  const employees = useEmployees(allowed);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PayrollFilter>("all");
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const all = useMemo(() => obligations.data ?? [], [obligations.data]);
  // Names and shift ownership are read once per render of the data instead of
  // once per card and per keystroke.
  const employeeNames = useMemo(
    () =>
      new Map(
        (employees.data ?? []).map((employee) => [
          employee.id,
          employee.name,
        ]),
      ),
    [employees.data],
  );
  const activeEmployees = useMemo(
    () => (employees.data ?? []).filter((employee) => employee.active),
    [employees.data],
  );
  const usedShiftIds = useMemo(
    () =>
      new Set(
        all.flatMap((obligation) =>
          obligation.shiftMemberships.map((membership) => membership.shiftId),
        ),
      ),
    [all],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return all.filter((obligation) => {
      if (filter === "pending" && obligation.summary.status === "completed") {
        return false;
      }
      if (filter === "completed" && obligation.summary.status !== "completed") {
        return false;
      }
      if (filter === "shifts" && obligation.kind !== "SHIFT_GROUP") {
        return false;
      }
      if (!query) return true;
      return (employeeNames.get(obligation.employeeId) ?? "")
        .toLowerCase()
        .includes(query);
    });
  }, [all, employeeNames, filter, search]);

  // The strip aggregates the server's per-obligation summary. It never re-prices
  // an obligation's installments, and it adds the decimal strings exactly.
  const pendingTotal = useMemo(
    () =>
      sumServerAmounts(
        all
          .filter((obligation) => obligation.summary.status !== "completed")
          .map((obligation) => obligation.summary.balance),
      ),
    [all],
  );
  const paidTotal = useMemo(
    () => sumServerAmounts(all.map((obligation) => obligation.summary.paid)),
    [all],
  );

  const count =
    obligations.isLoading || obligations.isError
      ? undefined
      : `${visible.length} ${visible.length === 1 ? "pago" : "pagos"}`;

  return (
    <DashboardLayout>
      {allowed ? (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Nómina"
            subtitle="Pagos y abonos de empleados"
            count={count}
            actions={
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => setDialog({ kind: "create" })}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nuevo pago
              </Button>
            }
          />

          {!obligations.isLoading &&
            !obligations.isError &&
            all.length > 0 && (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <MetricCard
                  label="Saldo pendiente"
                  value={pendingTotal}
                  helper="En pagos abiertos"
                />
                <MetricCard
                  label="Total pagado"
                  value={paidTotal}
                  helper="Abonos registrados"
                />
                <MetricCard
                  label="Pagos"
                  value={String(all.length)}
                  helper="Fijos y por jornadas"
                />
              </div>
            )}

          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Buscar por empleado..."
            filterControls={
              <FilterGroup label="Estado">
                {FILTERS.map((option) => (
                  <FilterOptionButton
                    key={option.value}
                    active={filter === option.value}
                    onClick={() => setFilter(option.value)}
                  >
                    {option.label}
                  </FilterOptionButton>
                ))}
              </FilterGroup>
            }
          />

          {obligations.isLoading ? (
            <CardSkeleton count={4} label="Cargando pagos de nómina..." />
          ) : obligations.isError ? (
            <ErrorState
              message="No se pudieron cargar los pagos"
              retryLabel="Reintentar"
              onRetry={() => void obligations.refetch()}
            />
          ) : !all.length ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5 text-muted-foreground" />}
              title="No hay pagos registrados"
              subtitle="Crea tu primer pago fijo o por jornadas"
            />
          ) : !visible.length ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5 text-muted-foreground" />}
              title="Sin resultados"
              subtitle="Ajusta la búsqueda o el filtro de estado"
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3 stagger-children">
              {visible.map((obligation) => (
                <li key={obligation.id} className="min-w-0">
                  <ObligationCard
                    obligation={obligation}
                    employeeName={
                      employeeNames.get(obligation.employeeId) ??
                      "Empleado sin nombre"
                    }
                    onRegisterInstallment={(target) =>
                      setDialog({ kind: "installment", obligation: target })
                    }
                    onCorrectInstallment={(target) =>
                      setDialog({ kind: "correction", obligation: target })
                    }
                    onRegisterCashReturn={(target, installment) =>
                      setDialog({
                        kind: "return",
                        obligation: target,
                        installment,
                      })
                    }
                    onReplacePayment={(target) =>
                      setDialog({ kind: "replacement", obligation: target })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <PageHeader title="Nómina" subtitle="Pagos y abonos de empleados" />
          <Card className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">
              No tienes acceso a la nómina
            </p>
            <p className="text-xs text-muted-foreground">
              Esta sección es solo para propietarios y administradores.
            </p>
          </Card>
        </div>
      )}

      {allowed && dialog?.kind === "create" && (
        <CreatePaymentDialog
          employees={activeEmployees}
          usedShiftIds={usedShiftIds}
          onClose={() => setDialog(null)}
        />
      )}
      {allowed && dialog?.kind === "installment" && (
        <InstallmentDialog
          obligation={dialog.obligation}
          onClose={() => setDialog(null)}
        />
      )}
      {allowed && dialog?.kind === "correction" && (
        <CorrectionDialog
          obligation={dialog.obligation}
          onClose={() => setDialog(null)}
        />
      )}
      {allowed && dialog?.kind === "return" && (
        <CashReturnDialog
          obligation={dialog.obligation}
          installment={dialog.installment}
          onClose={() => setDialog(null)}
        />
      )}
      {allowed && dialog?.kind === "replacement" && (
        <ReplacementPaymentDialog
          obligation={dialog.obligation}
          onClose={() => setDialog(null)}
        />
      )}
    </DashboardLayout>
  );
}
