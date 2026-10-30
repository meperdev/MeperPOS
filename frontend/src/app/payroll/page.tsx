"use client";

import { useState, type ReactNode } from "react";
import { Banknote, Wallet } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useEmployeeShifts } from "@/hooks/useEmployeeShifts";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import {
  useCorrectPayrollPeriodInstallment,
  useCreatePayrollGroup,
  useCreatePayrollGroupInstallment,
  useCreatePayrollPeriod,
  useCreatePayrollPeriodInstallment,
  usePayrollObligations,
  type PayrollObligation,
  type PayrollPaymentMethod,
} from "@/hooks/usePayroll";
import { getApiErrorMessage } from "@/lib/api";
import { toFiniteNumber } from "@/lib/utils";

const KIND_LABELS: Record<PayrollObligation["kind"], string> = {
  FIXED_PERIOD: "Salario fijo",
  SHIFT_GROUP: "Jornadas",
};

const PAYMENT_METHODS: Record<PayrollPaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

const METHOD_OPTIONS = (["CASH", "CARD", "TRANSFER"] as const).map((value) => ({
  value,
  label: PAYMENT_METHODS[value],
}));

const SHIFT_KIND_LABELS = { FULL_DAY: "Día completo", PARTIAL_DAY: "Día parcial" } as const;

const EXPENSE_TOGGLE_LABEL = "Generar gasto al completar el pago";

// S6: a correction is not an edit of the payment. It fixes an amount that was
// recorded wrongly, so the cash row keeps the date and method it already had and
// the server — not this form — decides the expense date. Reaching the exact
// outstanding total is a completion, not a pending payment, so the dialog says so.
const CORRECTION_INTRO =
  "Corrige un abono registrado con un importe equivocado. El movimiento de caja conserva su fecha y su método de pago; la fecha del gasto la decide el servidor.";
const CORRECTION_COMPLETION_NOTICE =
  "Si el importe corregido iguala el saldo pendiente, el pago se completa y se aplica la opción de gasto elegida.";

// The server owns every amount and sends it as a decimal string. The client only
// formats it for display; it never adds, splits or re-derives a money value.
const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: string): string {
  return COP.format(toFiniteNumber(value));
}

/** Payroll dates are stored date-only; show the calendar day the user stored. */
function day(value: string): string {
  return value.slice(0, 10);
}

function expenseLabel(obligation: PayrollObligation): string {
  if (obligation.expenseEnabled === null) return "Gasto al completar: Sin definir";
  if (!obligation.expenseEnabled) return "Gasto al completar: No";
  return obligation.selectedExpenseDate
    ? `Gasto al completar: Sí · ${day(obligation.selectedExpenseDate)}`
    : "Gasto al completar: Sí";
}

function PayrollDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal isOpen onClose={onClose} title={title}>
      {children}
    </Modal>
  );
}

function ExpenseChoiceFields({
  enabled,
  date,
  onToggle,
  onDateChange,
}: {
  enabled: boolean;
  date: string;
  onToggle: (enabled: boolean) => void;
  onDateChange: (date: string) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        {EXPENSE_TOGGLE_LABEL}
      </label>
      {enabled && (
        <Input
          label="Fecha del gasto (opcional)"
          type="date"
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
        />
      )}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs font-medium text-danger">
      {message}
    </p>
  ) : null;
}

function PeriodDialog({ employees, onClose }: { employees: Employee[]; onClose: () => void }) {
  const create = useCreatePayrollPeriod();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodAmount, setPeriodAmount] = useState("");
  const [expenseEnabled, setExpenseEnabled] = useState(false);
  const [expenseDate, setExpenseDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await create.mutateAsync({
        employeeId,
        periodStart,
        periodEnd,
        periodAmount,
        expenseEnabled,
        ...(expenseEnabled && expenseDate ? { selectedExpenseDate: expenseDate } : {}),
      });
      toast.success("Pago fijo creado");
      onClose();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, "No se pudo crear el pago fijo"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollDialog title="Nuevo pago fijo" onClose={() => { if (!saving) onClose(); }}>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="grid gap-3">
          <Select
            label="Empleado"
            required
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            options={[{ value: "", label: "Selecciona un empleado" }, ...employees.map((employee) => ({ value: employee.id, label: employee.name }))]}
          />
          <Input label="Fecha inicial" type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          <Input label="Fecha final" type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          <Input
            label="Monto del período"
            type="number"
            required
            min="0.01"
            max="9999999999.99"
            step="0.01"
            value={periodAmount}
            onChange={(event) => setPeriodAmount(event.target.value)}
          />
          <ExpenseChoiceFields
            enabled={expenseEnabled}
            date={expenseDate}
            onToggle={setExpenseEnabled}
            onDateChange={setExpenseDate}
          />
          <FormError message={error} />
          <div>
            <Button type="submit" disabled={saving}>Crear pago</Button>
          </div>
        </fieldset>
      </form>
    </PayrollDialog>
  );
}

function GroupDialog({
  employees,
  usedShiftIds,
  onClose,
}: {
  employees: Employee[];
  usedShiftIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const create = useCreatePayrollGroup();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const shifts = useEmployeeShifts(employeeId, Boolean(employeeId));
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [expenseEnabled, setExpenseEnabled] = useState(false);
  const [expenseDate, setExpenseDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A shift already owned by any payment is not available for a new one, so the
  // selection is limited to the server's stored memberships.
  const availableShifts = (shifts.data ?? []).filter((shift) => !usedShiftIds.has(shift.id));

  function chooseEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    setSelectedShiftIds([]);
    setError(null);
  }

  function toggleShift(shiftId: string, checked: boolean) {
    setSelectedShiftIds((current) =>
      checked ? [...current, shiftId] : current.filter((id) => id !== shiftId),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!selectedShiftIds.length) {
      setError("Selecciona al menos una jornada");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await create.mutateAsync({
        employeeId,
        shiftIds: selectedShiftIds,
        expenseEnabled,
        ...(expenseEnabled && expenseDate ? { selectedExpenseDate: expenseDate } : {}),
      });
      toast.success("Pago por jornadas creado");
      onClose();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, "No se pudo crear el pago por jornadas"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollDialog title="Nuevo pago por jornadas" onClose={() => { if (!saving) onClose(); }}>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="grid gap-3">
          <Select
            label="Empleado"
            required
            value={employeeId}
            onChange={(event) => chooseEmployee(event.target.value)}
            options={[{ value: "", label: "Selecciona un empleado" }, ...employees.map((employee) => ({ value: employee.id, label: employee.name }))]}
          />
          {!employeeId ? (
            <p className="text-sm text-muted-foreground">Selecciona un empleado para ver sus jornadas</p>
          ) : shifts.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando jornadas...</p>
          ) : shifts.isError ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-danger">No se pudieron cargar las jornadas</p>
              <Button type="button" variant="outline" onClick={() => void shifts.refetch()}>Reintentar</Button>
            </div>
          ) : !availableShifts.length ? (
            <p className="text-sm text-muted-foreground">No hay jornadas disponibles</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase text-muted-foreground">Jornadas disponibles</legend>
              {availableShifts.map((shift) => (
                <label key={shift.id} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Jornada ${day(shift.date)}`}
                    checked={selectedShiftIds.includes(shift.id)}
                    onChange={(event) => toggleShift(shift.id, event.target.checked)}
                  />
                  <span>{day(shift.date)} · {SHIFT_KIND_LABELS[shift.kind]} · {money(shift.amount)}</span>
                </label>
              ))}
            </fieldset>
          )}
          <ExpenseChoiceFields
            enabled={expenseEnabled}
            date={expenseDate}
            onToggle={setExpenseEnabled}
            onDateChange={setExpenseDate}
          />
          <FormError message={error} />
          <div>
            <Button type="submit" disabled={saving}>Crear pago</Button>
          </div>
        </fieldset>
      </form>
    </PayrollDialog>
  );
}

function InstallmentDialog({ obligation, onClose }: { obligation: PayrollObligation; onClose: () => void }) {
  const periodInstallment = useCreatePayrollPeriodInstallment();
  const groupInstallment = useCreatePayrollGroupInstallment();
  const create = obligation.kind === "FIXED_PERIOD" ? periodInstallment : groupInstallment;
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<PayrollPaymentMethod>("CASH");
  const [saving, setSaving] = useState(false);
  // The route rejects an over-limit expense or an inactive payroll category with
  // its own message; keep the dialog open and show it verbatim.
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await create.mutateAsync({
        employeeId: obligation.employeeId,
        obligationId: obligation.id,
        amount,
        date,
        method,
      });
      toast.success("Abono registrado");
      onClose();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, "No se pudo registrar el abono"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollDialog title="Registrar abono" onClose={() => { if (!saving) onClose(); }}>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="grid gap-3">
          <Input label="Monto del abono" type="number" required min="0.01" max="9999999999.99" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <Input label="Fecha del abono" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          <Select
            label="Método de pago"
            value={method}
            onChange={(event) => setMethod(event.target.value as PayrollPaymentMethod)}
            options={METHOD_OPTIONS}
          />
          <FormError message={error} />
          <div>
            <Button type="submit" disabled={saving}>Guardar abono</Button>
          </div>
        </fieldset>
      </form>
    </PayrollDialog>
  );
}

function CorrectionDialog({ obligation, onClose }: { obligation: PayrollObligation; onClose: () => void }) {
  const correction = useCorrectPayrollPeriodInstallment();
  const toast = useToast();
  const [installmentId, setInstallmentId] = useState(obligation.installments[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  // The route refuses an over-total correction, an unchanged amount, a frozen or
  // modified payment and an over-limit completion expense; show it verbatim.
  const [error, setError] = useState<string | null>(null);

  const selected = obligation.installments.find((item) => item.id === installmentId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !selected) return;
    setSaving(true);
    setError(null);
    try {
      await correction.mutateAsync({
        employeeId: obligation.employeeId,
        obligationId: obligation.id,
        installmentId: selected.id,
        amount,
      });
      toast.success("Abono corregido");
      onClose();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, "No se pudo corregir el abono"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollDialog title="Corregir abono" onClose={() => { if (!saving) onClose(); }}>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="grid gap-3">
          <Select
            label="Abono a corregir"
            required
            value={installmentId}
            onChange={(event) => {
              setInstallmentId(event.target.value);
              setError(null);
            }}
            options={obligation.installments.map((item) => ({
              value: item.id,
              label: `${day(item.outflow.date)} · ${money(item.outflow.amount)}`,
            }))}
          />
          {selected && (
            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Importe registrado</dt>
                <dd data-testid="correction-current-amount" className="font-mono tabular-nums">
                  {money(selected.outflow.amount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fecha del movimiento</dt>
                <dd data-testid="correction-current-date" className="font-mono tabular-nums">
                  {day(selected.outflow.date)}
                </dd>
              </div>
            </dl>
          )}
          <Input
            label="Importe corregido"
            type="number"
            required
            min="0.01"
            max="9999999999.99"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{CORRECTION_INTRO}</p>
          <p className="text-xs text-muted-foreground">{CORRECTION_COMPLETION_NOTICE}</p>
          <FormError message={error} />
          <div>
            <Button type="submit" disabled={saving}>Guardar corrección</Button>
          </div>
        </fieldset>
      </form>
    </PayrollDialog>
  );
}

function ObligationCard({
  obligation,
  employeeName,
  onRegisterInstallment,
  onCorrectInstallment,
}: {
  obligation: PayrollObligation;
  employeeName: string;
  onRegisterInstallment: (obligation: PayrollObligation) => void;
  onCorrectInstallment: (obligation: PayrollObligation) => void;
}) {
  const completed = obligation.summary.status === "completed";
  // S6: only a wrongly recorded fixed-period installment can be corrected, and
  // only while the payment is pending; a completed payment and its expense are
  // frozen. The correction route has no shift-group equivalent.
  const canCorrect = obligation.kind === "FIXED_PERIOD" && obligation.installments.length > 0;
  return (
    <article className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{employeeName}</h2>
          <p className="text-sm text-muted-foreground">
            {KIND_LABELS[obligation.kind]} · {completed ? "Completado" : "Pendiente"}
          </p>
          {obligation.kind === "FIXED_PERIOD" && obligation.periodStart && obligation.periodEnd && (
            <p className="text-sm text-muted-foreground">Período {day(obligation.periodStart)} — {day(obligation.periodEnd)}</p>
          )}
          <p className="text-sm text-muted-foreground">{expenseLabel(obligation)}</p>
        </div>
        <Badge variant={completed ? "success" : "warning"}>{completed ? "Completado" : "Pendiente"}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Total</dt>
          <dd data-testid={`summary-total-${obligation.id}`} className="font-mono">{money(obligation.summary.total)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Pagado</dt>
          <dd data-testid={`summary-paid-${obligation.id}`} className="font-mono">{money(obligation.summary.paid)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Saldo</dt>
          <dd data-testid={`summary-balance-${obligation.id}`} className="font-mono">{money(obligation.summary.balance)}</dd>
        </div>
      </dl>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abonos</h3>
        {obligation.installments.length ? (
          <ul className="space-y-1 text-sm">
            {obligation.installments.map((installment) => (
              <li key={installment.id}>
                {day(installment.outflow.date)} · {PAYMENT_METHODS[installment.outflow.method]} · {money(installment.outflow.amount)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sin abonos</p>
        )}
      </div>
      {!completed && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onRegisterInstallment(obligation)} aria-label={`Registrar abono ${employeeName}`}>
            Registrar abono
          </Button>
          {canCorrect && (
            <Button variant="outline" onClick={() => onCorrectInstallment(obligation)} aria-label={`Corregir abono ${employeeName}`}>
              Corregir abono
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export default function PayrollPage() {
  const { user } = useAuth();
  // S5: payroll belongs to owners and administrators only. The route map and the
  // sidebar hide it from every other role; the API enforces the same rule.
  const allowed = user?.role === "OWNER" || user?.role === "ADMIN";
  const obligations = usePayrollObligations(allowed);
  const employees = useEmployees(allowed);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [installmentFor, setInstallmentFor] = useState<PayrollObligation | null>(null);
  const [correctionFor, setCorrectionFor] = useState<PayrollObligation | null>(null);

  const activeEmployees = (employees.data ?? []).filter((employee) => employee.active);
  const employeeName = (employeeId: string) =>
    employees.data?.find((employee) => employee.id === employeeId)?.name ?? "Empleado sin nombre";
  const usedShiftIds = new Set(
    (obligations.data ?? []).flatMap((obligation) => obligation.shiftMemberships.map((membership) => membership.shiftId)),
  );

  return (
    <DashboardLayout>
      {allowed && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Nómina</h1>
              <p className="text-sm text-muted-foreground">Pagos y abonos de empleados</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPeriodOpen(true)}>Nuevo pago fijo</Button>
              <Button variant="outline" onClick={() => setGroupOpen(true)}>Nuevo pago por jornadas</Button>
            </div>
          </div>

          {obligations.isLoading ? (
            <LoadingState icon={<Banknote className="w-4 h-4 text-primary" />} message="Cargando pagos de nómina..." />
          ) : obligations.isError ? (
            <ErrorState message="No se pudieron cargar los pagos" retryLabel="Reintentar" onRetry={() => void obligations.refetch()} />
          ) : !obligations.data?.length ? (
            <EmptyState icon={<Wallet className="w-5 h-5 text-muted-foreground" />} title="No hay pagos registrados" subtitle="Crea tu primer pago fijo o por jornadas" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {obligations.data.map((obligation) => (
                <ObligationCard
                  key={obligation.id}
                  obligation={obligation}
                  employeeName={employeeName(obligation.employeeId)}
                  onRegisterInstallment={setInstallmentFor}
                  onCorrectInstallment={setCorrectionFor}
                />
              ))}
            </div>
          )}

          {periodOpen && <PeriodDialog employees={activeEmployees} onClose={() => setPeriodOpen(false)} />}
          {groupOpen && (
            <GroupDialog employees={activeEmployees} usedShiftIds={usedShiftIds} onClose={() => setGroupOpen(false)} />
          )}
          {installmentFor && <InstallmentDialog obligation={installmentFor} onClose={() => setInstallmentFor(null)} />}
          {correctionFor && <CorrectionDialog obligation={correctionFor} onClose={() => setCorrectionFor(null)} />}
        </div>
      )}
    </DashboardLayout>
  );
}
