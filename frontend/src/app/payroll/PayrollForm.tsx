"use client";

import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MoneyField } from "@/components/ui/MoneyField";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import type { Employee } from "@/hooks/useEmployees";
import type { PayrollPaymentMethod } from "@/hooks/usePayroll";

export const PAYMENT_METHODS: Record<PayrollPaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

export const METHOD_OPTIONS = (["CASH", "CARD", "TRANSFER"] as const).map(
  (value) => ({ value, label: PAYMENT_METHODS[value] }),
);

export const SHIFT_KIND_LABELS = {
  FULL_DAY: "Día completo",
  PARTIAL_DAY: "Día parcial",
} as const;

export const EXPENSE_TOGGLE_LABEL = "Generar gasto al completar el pago";

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs font-medium text-danger"
    >
      {message}
    </p>
  ) : null;
}

/**
 * The one dialog scaffold of this screen. Every form opens through it, so the
 * footer owns the actions (the primary one on the right), saving is a real busy
 * state instead of a dead disabled button, and the body is locked while the
 * request is in flight. The accessible name stays the caller's title, which is
 * what the dialogs are known by.
 */
export function PayrollFormDialog({
  title,
  submitLabel,
  onClose,
  onSubmit,
  saving,
  error,
  children,
}: {
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} aria-busy={saving}>
      <Modal
        isOpen
        onClose={() => {
          if (!saving) onClose();
        }}
        title={title}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={saving} className="w-full sm:w-auto">
              {submitLabel}
            </Button>
          </div>
        }
      >
        <fieldset disabled={saving} className="grid gap-3">
          {children}
          <FormError message={error} />
        </fieldset>
      </Modal>
    </form>
  );
}

/**
 * Read-only facts a dialog needs before asking for a decision (the installment
 * being corrected, the money coming back, the totals a replacement references).
 * One layout and one typographic treatment for every dialog.
 */
export function PayrollFacts({
  items,
  columns = 2,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode; testId?: string }>;
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-2 rounded-xl border border-border/60 bg-muted/25 p-3 text-xs",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd
            data-testid={item.testId}
            className="mt-0.5 truncate font-mono font-semibold text-foreground tabular-nums"
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ExpenseChoiceFields({
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
      <label className="flex items-center gap-2 text-xs font-medium text-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border/70 accent-primary"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
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

export function EmployeeSelect({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: string;
  onChange: (employeeId: string) => void;
}) {
  return (
    <Select
      label="Empleado"
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "", label: "Selecciona un empleado" },
        ...employees.map((employee) => ({
          value: employee.id,
          label: employee.name,
        })),
      ]}
    />
  );
}

/**
 * Money is typed as the decimal text the route accepts, so the keyboard offers a
 * decimal pad instead of a spinner and the exact string reaches the request.
 */
export function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <MoneyField label={label} value={value} onChange={onChange} required />
  );
}

/** One selectable row (shift or installment) shared by the two pickers. */
export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3 text-xs transition-colors hover:bg-muted/30">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border/70 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}
