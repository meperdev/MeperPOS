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
import { Pagination } from "@/components/ui/Pagination";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import { cn } from "@/lib/utils";
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
import { ObligationCard, buildObligationActions } from "./ObligationCard";
import { payrollDateShort, payrollMoney, sumServerAmounts } from "./format";

type PayrollFilter = "all" | "pending" | "completed" | "shifts";

function periodLabel(obligation: PayrollObligation): string {
  if (obligation.kind === "FIXED_PERIOD" && obligation.periodStart && obligation.periodEnd) {
    return `${payrollDateShort(obligation.periodStart)} – ${payrollDateShort(obligation.periodEnd)}`;
  }
  const shifts = obligation.shiftMemberships.length;
  return `${shifts} ${shifts === 1 ? "jornada" : "jornadas"}`;
}

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
  const [viewMode, setViewMode] = usePersistedViewMode("payroll");
  const [page, setPage] = useState(1);
  const pageSize = viewMode === "table" ? 10 : 9;

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

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));

  const actionHandlers = {
    onRegisterInstallment: (target: PayrollObligation) =>
      setDialog({ kind: "installment", obligation: target }),
    onCorrectInstallment: (target: PayrollObligation) =>
      setDialog({ kind: "correction", obligation: target }),
    onRegisterCashReturn: (
      target: PayrollObligation,
      installment: PayrollInstallment,
    ) => setDialog({ kind: "return", obligation: target, installment }),
    onReplacePayment: (target: PayrollObligation) =>
      setDialog({ kind: "replacement", obligation: target }),
  };

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
        <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-4">
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
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            searchPlaceholder="Buscar por empleado..."
            filterControls={
              <>
                <FilterGroup label="Estado">
                  {FILTERS.map((option) => (
                    <FilterOptionButton
                      key={option.value}
                      active={filter === option.value}
                      onClick={() => {
                        setFilter(option.value);
                        setPage(1);
                      }}
                    >
                      {option.label}
                    </FilterOptionButton>
                  ))}
                </FilterGroup>
                <ViewModeToggle
                  value={viewMode}
                  onChange={(mode) => {
                    setViewMode(mode);
                    setPage(1);
                  }}
                />
              </>
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
            <>
              {viewMode === "table" ? (
                <>
                  <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card sm:block">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableCell as="th">Empleado</TableCell>
                            <TableCell as="th">Tipo</TableCell>
                            <TableCell as="th">Período</TableCell>
                            <TableCell as="th" className="text-right">
                              Total
                            </TableCell>
                            <TableCell as="th" className="text-right">
                              Saldo
                            </TableCell>
                            <TableCell as="th">Estado</TableCell>
                            <TableCell as="th" className="text-right">
                              <span className="sr-only">Acciones</span>
                            </TableCell>
                          </TableRow>
                        </TableHeader>
                        <tbody>
                          {paged.map((obligation) => {
                            const name =
                              employeeNames.get(obligation.employeeId) ??
                              "Empleado sin nombre";
                            const balance = Number(obligation.summary.balance);
                            return (
                              <TableRow key={obligation.id}>
                                <TableCell className="text-xs font-semibold text-foreground">
                                  {name}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                  {obligation.kind === "FIXED_PERIOD"
                                    ? "Pago fijo"
                                    : "Por jornadas"}
                                </TableCell>
                                <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                                  {periodLabel(obligation)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs tabular-nums">
                                  {payrollMoney(obligation.summary.total)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right font-mono text-xs tabular-nums",
                                    balance > 0
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {payrollMoney(obligation.summary.balance)}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge
                                    domain="payroll"
                                    status={obligation.summary.status.toUpperCase()}
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <RowActions
                                    label={`Acciones de ${name}`}
                                    items={buildObligationActions(
                                      obligation,
                                      actionHandlers,
                                    )}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  </div>
                  <ul className="stagger-children grid grid-cols-1 gap-3.5 sm:hidden">
                    {paged.map((obligation) => (
                      <li key={obligation.id} className="min-w-0">
                        <ObligationCard
                          obligation={obligation}
                          employeeName={
                            employeeNames.get(obligation.employeeId) ??
                            "Empleado sin nombre"
                          }
                          {...actionHandlers}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="stagger-children grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {paged.map((obligation) => (
                    <li key={obligation.id} className="min-w-0">
                      <ObligationCard
                        obligation={obligation}
                        employeeName={
                          employeeNames.get(obligation.employeeId) ??
                          "Empleado sin nombre"
                        }
                        {...actionHandlers}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <Pagination
                className="mt-auto"
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                totalItems={visible.length}
                pageSize={pageSize}
                itemLabel="pago"
              />
            </>
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
