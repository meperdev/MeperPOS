"use client";

import { useState, type FormEvent } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterGroup, FilterOptionButton } from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/contexts/ToastContext";
import { useEmployeeShifts } from "@/hooks/useEmployeeShifts";
import type { Employee } from "@/hooks/useEmployees";
import {
  useCorrectPayrollPeriodInstallment,
  useCreatePayrollCashReturn,
  useCreatePayrollGroup,
  useCreatePayrollGroupInstallment,
  useCreatePayrollPeriod,
  useCreatePayrollPeriodInstallment,
  useCreatePayrollReplacementPayment,
  type PayrollInstallment,
  type PayrollObligation,
  type PayrollObligationKind,
  type PayrollPaymentMethod,
} from "@/hooks/usePayroll";
import { getApiErrorMessage } from "@/lib/api";
import { getBogotaDateInputValue } from "@/lib/utils";
import {
  payrollCents,
  payrollCentsToMoney,
  payrollDate,
  payrollMoney,
} from "./format";
import {
  CheckRow,
  EmployeeSelect,
  ExpenseChoiceFields,
  METHOD_OPTIONS,
  MoneyInput,
  PAYMENT_METHODS,
  PayrollFacts,
  PayrollFormDialog,
  SHIFT_KIND_LABELS,
} from "./PayrollForm";

// S6: a correction is not an edit of the payment. It fixes an amount that was
// recorded wrongly, so the cash row keeps the date and method it already had and
// the server — not this form — decides the expense date. Reaching the exact
// outstanding total is a completion, not a pending payment, so the dialog says so.
const CORRECTION_INTRO =
  "Corrige un abono registrado con un importe equivocado. El movimiento de caja conserva su fecha y su método de pago; la fecha del gasto la decide el servidor.";
const CORRECTION_COMPLETION_NOTICE =
  "Si el importe corregido iguala el saldo pendiente, el pago se completa y se aplica la opción de gasto elegida.";

// S7/S8: a real return is the money an employee actually gave back, so it is not
// an amount to type: one return covers exactly one complete installment (L329) and
// the amount comes from the stored cash outflow. Only the day the money came back
// (L325) and the real method it came back by (L330) are human choices, and neither
// the paid installment nor its linked expense is rewritten (L326).
const CASH_RETURN_INTRO =
  "Registra el dinero que el empleado devolvió de un abono ya pagado. La devolución cubre el abono completo.";
const CASH_RETURN_EFFECT_NOTICE =
  "El abono y su gasto quedan sin cambios; el importe devuelto se descuenta en caja con la fecha y el medio reales.";

// S6/S7 (L327, L338): a completed payment is never edited. The replacement is a
// NEW pending payment that references the valid installments of the completed
// one, so their cash counts as already paid without a second cash outflow. The
// dialog therefore never asks for an amount: it asks which installments are
// valid, the period of the new payment and that payment's own expense choice.
const REPLACEMENT_INTRO =
  "Crea un pago nuevo que referencia los abonos válidos del pago completado. El pago original, su caja y su gasto quedan sin cambios.";
const REPLACEMENT_PREVIEW_NOTICE =
  "Desmarca los abonos registrados por error: quedan como saldo a pagar del pago nuevo. Los importes definitivos los calcula el servidor a partir de los abonos referenciados.";
const REPLACEMENT_EMPTY_SELECTION = "Selecciona al menos un abono";

const NO_SHIFT_SELECTION = "Selecciona al menos una jornada";

// The new payment keeps the dates of the payment it replaces unless the actor
// states others: a fixed-period payment keeps its period, a grouped payment keeps
// the span of the shifts it paid.
function sourcePeriod(obligation: PayrollObligation): {
  start: string;
  end: string;
} {
  if (
    obligation.kind === "FIXED_PERIOD" &&
    obligation.periodStart &&
    obligation.periodEnd
  ) {
    return {
      start: obligation.periodStart.slice(0, 10),
      end: obligation.periodEnd.slice(0, 10),
    };
  }
  const days = obligation.shiftMemberships
    .map((membership) => membership.shift.date.slice(0, 10))
    .sort();
  if (!days.length) return { start: "", end: "" };
  return { start: days[0], end: days[days.length - 1] };
}

/**
 * A new payment is created in one place: the employee and the per-payment
 * expense choice exist once, and the kind switch only swaps the middle of the
 * form (period fields or the shifts it pays).
 */
export function CreatePaymentDialog({
  employees,
  usedShiftIds,
  onClose,
}: {
  employees: Employee[];
  usedShiftIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const periodCreate = useCreatePayrollPeriod();
  const groupCreate = useCreatePayrollGroup();
  const toast = useToast();
  const [kind, setKind] = useState<PayrollObligationKind>("FIXED_PERIOD");
  const [employeeId, setEmployeeId] = useState("");
  const shifts = useEmployeeShifts(employeeId, Boolean(employeeId));
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodAmount, setPeriodAmount] = useState("");
  const [expenseEnabled, setExpenseEnabled] = useState(false);
  const [expenseDate, setExpenseDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A shift already owned by any payment is not available for a new one, so the
  // selection is limited to the server's stored memberships.
  const availableShifts = (shifts.data ?? []).filter(
    (shift) => !usedShiftIds.has(shift.id),
  );

  function chooseKind(nextKind: PayrollObligationKind) {
    setKind(nextKind);
    setError(null);
  }

  function chooseEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    setSelectedShiftIds([]);
    setError(null);
  }

  function toggleShift(shiftId: string, checked: boolean) {
    setSelectedShiftIds((current) =>
      checked ? [...current, shiftId] : current.filter((id) => id !== shiftId),
    );
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (kind === "SHIFT_GROUP" && !selectedShiftIds.length) {
      setError(NO_SHIFT_SELECTION);
      return;
    }
    setSaving(true);
    setError(null);
    const expenseDateField =
      expenseEnabled && expenseDate ? { selectedExpenseDate: expenseDate } : {};
    try {
      if (kind === "FIXED_PERIOD") {
        await periodCreate.mutateAsync({
          employeeId,
          periodStart,
          periodEnd,
          periodAmount,
          expenseEnabled,
          ...expenseDateField,
        });
        toast.success("Pago fijo creado");
      } else {
        await groupCreate.mutateAsync({
          employeeId,
          shiftIds: selectedShiftIds,
          expenseEnabled,
          ...expenseDateField,
        });
        toast.success("Pago por jornadas creado");
      }
      onClose();
    } catch (submitError) {
      setError(
        getApiErrorMessage(
          submitError,
          kind === "FIXED_PERIOD"
            ? "No se pudo crear el pago fijo"
            : "No se pudo crear el pago por jornadas",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollFormDialog
      title={
        kind === "FIXED_PERIOD" ? "Nuevo pago fijo" : "Nuevo pago por jornadas"
      }
      submitLabel="Crear pago"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
    >
      <FilterGroup label="Tipo de pago">
        <FilterOptionButton
          active={kind === "FIXED_PERIOD"}
          onClick={() => chooseKind("FIXED_PERIOD")}
        >
          Pago fijo
        </FilterOptionButton>
        <FilterOptionButton
          active={kind === "SHIFT_GROUP"}
          onClick={() => chooseKind("SHIFT_GROUP")}
        >
          Por jornadas
        </FilterOptionButton>
      </FilterGroup>

      <EmployeeSelect
        employees={employees}
        value={employeeId}
        onChange={chooseEmployee}
      />

      {kind === "FIXED_PERIOD" ? (
        <>
          <Input
            label="Fecha inicial"
            type="date"
            required
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
          />
          <Input
            label="Fecha final"
            type="date"
            required
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
          <MoneyInput
            label="Monto del período"
            value={periodAmount}
            onChange={setPeriodAmount}
          />
        </>
      ) : !employeeId ? (
        <p className="text-xs text-muted-foreground">
          Selecciona un empleado para ver sus jornadas
        </p>
      ) : shifts.isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando jornadas...</p>
      ) : shifts.isError ? (
        <ErrorState
          className="min-h-[140px]"
          message="No se pudieron cargar las jornadas"
          retryLabel="Reintentar"
          onRetry={() => void shifts.refetch()}
        />
      ) : !availableShifts.length ? (
        <p className="text-xs text-muted-foreground">
          No hay jornadas disponibles
        </p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">
            Jornadas disponibles
          </legend>
          {availableShifts.map((shift) => (
            <CheckRow
              key={shift.id}
              checked={selectedShiftIds.includes(shift.id)}
              onChange={(checked) => toggleShift(shift.id, checked)}
            >
              <span className="font-mono text-foreground tabular-nums">
                {payrollDate(shift.date)} · {SHIFT_KIND_LABELS[shift.kind]} ·{" "}
                {payrollMoney(shift.amount)}
              </span>
            </CheckRow>
          ))}
        </fieldset>
      )}

      <ExpenseChoiceFields
        enabled={expenseEnabled}
        date={expenseDate}
        onToggle={setExpenseEnabled}
        onDateChange={setExpenseDate}
      />
    </PayrollFormDialog>
  );
}

export function InstallmentDialog({
  obligation,
  onClose,
}: {
  obligation: PayrollObligation;
  onClose: () => void;
}) {
  const periodInstallment = useCreatePayrollPeriodInstallment();
  const groupInstallment = useCreatePayrollGroupInstallment();
  const create =
    obligation.kind === "FIXED_PERIOD" ? periodInstallment : groupInstallment;
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<PayrollPaymentMethod>("CASH");
  const [saving, setSaving] = useState(false);
  // The route rejects an over-limit expense or an inactive payroll category with
  // its own message; keep the dialog open and show it verbatim.
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
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
    <PayrollFormDialog
      title="Registrar abono"
      submitLabel="Guardar abono"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
    >
      <MoneyInput label="Monto del abono" value={amount} onChange={setAmount} />
      <Input
        label="Fecha del abono"
        type="date"
        required
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <Select
        label="Método de pago"
        value={method}
        onChange={(event) =>
          setMethod(event.target.value as PayrollPaymentMethod)
        }
        options={METHOD_OPTIONS}
      />
    </PayrollFormDialog>
  );
}

export function CorrectionDialog({
  obligation,
  onClose,
}: {
  obligation: PayrollObligation;
  onClose: () => void;
}) {
  const correction = useCorrectPayrollPeriodInstallment();
  const toast = useToast();
  const [installmentId, setInstallmentId] = useState(
    obligation.installments[0]?.id ?? "",
  );
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  // The route refuses an over-total correction, an unchanged amount, a frozen or
  // modified payment and an over-limit completion expense; show it verbatim.
  const [error, setError] = useState<string | null>(null);

  const selected = obligation.installments.find(
    (item) => item.id === installmentId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
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
    <PayrollFormDialog
      title="Corregir abono"
      submitLabel="Guardar corrección"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
    >
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
          label: `${payrollDate(item.outflow.date)} · ${payrollMoney(item.outflow.amount)}`,
        }))}
      />
      {selected && (
        <PayrollFacts
          items={[
            {
              label: "Importe registrado",
              value: payrollMoney(selected.outflow.amount),
              testId: "correction-current-amount",
            },
            {
              label: "Fecha del movimiento",
              value: payrollDate(selected.outflow.date),
              testId: "correction-current-date",
            },
          ]}
        />
      )}
      <MoneyInput
        label="Importe corregido"
        value={amount}
        onChange={setAmount}
      />
      <p className="text-xs text-muted-foreground">{CORRECTION_INTRO}</p>
      <p className="text-xs text-muted-foreground">
        {CORRECTION_COMPLETION_NOTICE}
      </p>
    </PayrollFormDialog>
  );
}

export function CashReturnDialog({
  obligation,
  installment,
  onClose,
}: {
  obligation: PayrollObligation;
  installment: PayrollInstallment;
  onClose: () => void;
}) {
  const createReturn = useCreatePayrollCashReturn();
  const toast = useToast();
  // The money came back on a calendar day, so the default is today in Bogotá —
  // never the UTC day, which is already tomorrow for part of the local evening.
  const [returnDate, setReturnDate] = useState(() => getBogotaDateInputValue());
  const [returnMethod, setReturnMethod] = useState<PayrollPaymentMethod>("CASH");
  const [saving, setSaving] = useState(false);
  // The route refuses a second return, an unpaid installment or a foreign payment;
  // keep the dialog open so the message can be read and corrected.
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await createReturn.mutateAsync({
        employeeId: obligation.employeeId,
        obligationId: obligation.id,
        installmentId: installment.id,
        returnDate,
        returnMethod,
      });
      toast.success("Devolución registrada");
      onClose();
    } catch (submitError) {
      setError(
        getApiErrorMessage(
          submitError,
          "No se pudo registrar la devolución",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollFormDialog
      title="Registrar devolución"
      submitLabel="Guardar devolución"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
    >
      <PayrollFacts
        items={[
          {
            label: "Abono devuelto",
            value: payrollMoney(installment.outflow.amount),
            testId: "cash-return-amount",
          },
          {
            label: "Pagado el",
            value: `${payrollDate(installment.outflow.date)} · ${
              PAYMENT_METHODS[installment.outflow.method]
            }`,
          },
        ]}
      />
      <Input
        label="Fecha de la devolución"
        type="date"
        required
        value={returnDate}
        onChange={(event) => setReturnDate(event.target.value)}
      />
      <Select
        label="Método de la devolución"
        value={returnMethod}
        onChange={(event) =>
          setReturnMethod(event.target.value as PayrollPaymentMethod)
        }
        options={METHOD_OPTIONS}
      />
      <p className="text-xs text-muted-foreground">{CASH_RETURN_INTRO}</p>
      <p className="text-xs text-muted-foreground">
        {CASH_RETURN_EFFECT_NOTICE}
      </p>
    </PayrollFormDialog>
  );
}

export function ReplacementPaymentDialog({
  obligation,
  onClose,
}: {
  obligation: PayrollObligation;
  onClose: () => void;
}) {
  const replacement = useCreatePayrollReplacementPayment();
  const toast = useToast();
  // Every installment starts selected: the actor unchecks the registrations that
  // were wrong, and the ones that stay selected are the valid abonos whose cash
  // is referenced without charging it again (L327).
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    obligation.installments.map((installment) => installment.id),
  );
  const [period, setPeriod] = useState(() => sourcePeriod(obligation));
  const [expenseEnabled, setExpenseEnabled] = useState(false);
  const [expenseDate, setExpenseDate] = useState("");
  const [saving, setSaving] = useState(false);
  // The route refuses a reference that already covers the whole payment, cash
  // that was already referenced, a non-completed source and an inconsistent
  // history; keep its message verbatim and the dialog open.
  const [error, setError] = useState<string | null>(null);

  const selected = obligation.installments.filter((installment) =>
    selectedIds.includes(installment.id),
  );
  const referencedCents = selected.reduce(
    (total, installment) =>
      total + payrollCents(installment.outflow.amount),
    BigInt(0),
  );
  const totalCents = payrollCents(obligation.summary.total);
  const balanceCents =
    totalCents > referencedCents ? totalCents - referencedCents : BigInt(0);

  function toggleInstallment(installmentId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? [...current, installmentId]
        : current.filter((id) => id !== installmentId),
    );
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!selectedIds.length) {
      setError(REPLACEMENT_EMPTY_SELECTION);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await replacement.mutateAsync({
        employeeId: obligation.employeeId,
        sourceObligationId: obligation.id,
        installmentIds: selectedIds,
        periodStart: period.start,
        periodEnd: period.end,
        expenseEnabled,
        ...(expenseEnabled && expenseDate
          ? { selectedExpenseDate: expenseDate }
          : {}),
      });
      toast.success("Pago de reemplazo creado");
      onClose();
    } catch (submitError) {
      setError(
        getApiErrorMessage(
          submitError,
          "No se pudo crear el pago de reemplazo",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <PayrollFormDialog
      title="Reemplazar pago completado"
      submitLabel="Crear pago de reemplazo"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
    >
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">
          Abonos válidos a referenciar
        </legend>
        {obligation.installments.map((installment) => (
          <CheckRow
            key={installment.id}
            checked={selectedIds.includes(installment.id)}
            onChange={(checked) => toggleInstallment(installment.id, checked)}
          >
            <span className="font-mono text-foreground tabular-nums">
              {payrollDate(installment.outflow.date)} ·{" "}
              {PAYMENT_METHODS[installment.outflow.method]} ·{" "}
              {payrollMoney(installment.outflow.amount)}
            </span>
          </CheckRow>
        ))}
      </fieldset>
      <PayrollFacts
        columns={3}
        items={[
          {
            label: "Total del pago",
            value: payrollMoney(obligation.summary.total),
            testId: "replacement-source-total",
          },
          {
            label: "Total referenciado",
            value: payrollCentsToMoney(referencedCents),
            testId: "replacement-referenced-total",
          },
          {
            label: "Saldo a pagar",
            value: payrollCentsToMoney(balanceCents),
            testId: "replacement-balance-total",
          },
        ]}
      />
      <Input
        label="Fecha inicial del nuevo pago"
        type="date"
        required
        value={period.start}
        onChange={(event) =>
          setPeriod((current) => ({ ...current, start: event.target.value }))
        }
      />
      <Input
        label="Fecha final del nuevo pago"
        type="date"
        required
        value={period.end}
        onChange={(event) =>
          setPeriod((current) => ({ ...current, end: event.target.value }))
        }
      />
      <ExpenseChoiceFields
        enabled={expenseEnabled}
        date={expenseDate}
        onToggle={setExpenseEnabled}
        onDateChange={setExpenseDate}
      />
      <p className="text-xs text-muted-foreground">{REPLACEMENT_INTRO}</p>
      <p className="text-xs text-muted-foreground">
        {REPLACEMENT_PREVIEW_NOTICE}
      </p>
    </PayrollFormDialog>
  );
}
