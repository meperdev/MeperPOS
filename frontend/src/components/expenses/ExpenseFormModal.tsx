"use client";

import { useId, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { ImageUpload } from "@/components/ui/ImageUpload";
import {
  useCreateExpense,
  useExpenseGroups,
  useUpdateExpense,
  useUploadExpenseReceipt,
} from "@/hooks/useExpenses";
import { useSuppliers } from "@/hooks/useSuppliers";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency, getBogotaDateInputValue } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { Expense, ExpensePayment } from "@/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  expense?: Expense | null;
}

interface PaymentRow {
  tempId: string;
  amount: string;
  method: ExpensePayment["method"];
  date: string;
}

const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Efectivo" },
  { value: "CARD", label: "Tarjeta" },
  { value: "TRANSFER", label: "Transferencia" },
];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function newRow(): PaymentRow {
  return {
    tempId: genId(),
    amount: "",
    method: "CASH",
    date: getBogotaDateInputValue(),
  };
}

export function ExpenseFormModal({ isOpen, onClose, expense }: Props) {
  const toast = useToast();
  const uid = useId();
  const paymentsListRef = useRef<HTMLDivElement>(null);

  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const uploadReceipt = useUploadExpenseReceipt();

  const { data: groupsData, isLoading: isGroupsLoading } = useExpenseGroups();
  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data: ordersData } = usePurchaseOrders({ limit: 200 });

  const groups = groupsData ?? [];
  const suppliers = suppliersData?.data ?? [];
  const orders = ordersData?.data ?? [];

  const [groupId, setGroupId] = useState(expense?.label?.groupId ?? "");
  const [labelId, setLabelId] = useState(expense?.labelId ?? "");
  const [supplierId, setSupplierId] = useState(expense?.supplierId ?? "");
  const [purchaseOrderId, setPurchaseOrderId] = useState(
    expense?.purchaseOrderId ?? "",
  );
  const [description, setDescription] = useState(expense?.description ?? "");
  const [date, setDate] = useState(
    expense ? expense.date.slice(0, 10) : getBogotaDateInputValue(),
  );
  const [total, setTotal] = useState(expense ? String(expense.total) : "");
  const [rows, setRows] = useState<PaymentRow[]>(() =>
    expense ? [] : [newRow()],
  );
  const [pendingReceiptFile, setPendingReceiptFile] = useState<File | null>(
    null,
  );

  /**
   * Derived, not synced. A synchronous setState inside an effect body cascades
   * renders, which is what `react-hooks/set-state-in-effect` flags, so the group
   * and the label are computed from what the operator chose plus what the loaded
   * groups say. State keeps the choice; these keep it consistent.
   *
   * While the groups are still loading nothing is dropped: an edit form must not
   * blank a label it cannot validate yet. The lookup is deliberately not filtered
   * by `active`, so editing an expense that carries a now-inactive label does not
   * silently clear it.
   */
  const groupIdOfLabel = (id: string) =>
    groups
      .flatMap((group) => group.labels ?? [])
      .find((label) => label.id === id)?.groupId ?? "";

  const labelGroupId = groupIdOfLabel(labelId);
  const effectiveGroupId = groupId || labelGroupId;
  const effectiveLabelId =
    groups.length > 0 && labelGroupId !== effectiveGroupId
      ? ""
      : labelId;

  const labelOptions = effectiveGroupId
    ? (groups.find((group) => group.id === effectiveGroupId)?.labels ?? [])
        .filter((label) => label.active)
        .map((label) => ({ value: label.id, label: label.name }))
    : [];

  const numericTotal = Number(total) || 0;
  const paymentsSum = rows.reduce(
    (acc, row) => acc + (Number(row.amount) || 0),
    0,
  );
  const hasValidPayment = rows.some((row) => (Number(row.amount) || 0) > 0);
  const existingPaymentsSum = expense
    ? (expense.payments ?? []).reduce(
        (acc, payment) => acc + (Number(payment.amount) || 0),
        0,
      )
    : 0;

  const error = !effectiveLabelId
    ? "Selecciona una etiqueta de gasto"
    : !date
      ? "Selecciona una fecha"
      : numericTotal <= 0
        ? "Ingresa un total válido"
        : expense
          ? numericTotal < existingPaymentsSum
            ? "El nuevo total no puede ser menor a los pagos registrados"
            : null
          : !hasValidPayment
            ? "Agrega al menos un pago válido"
            : paymentsSum > numericTotal
              ? "El total de pagos supera el total del gasto"
              : null;

  const handleAddRow = () => {
    setRows((prev) => [...prev, newRow()]);
    setTimeout(() => {
      if (paymentsListRef.current) {
        paymentsListRef.current.scrollTo({
          top: paymentsListRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 60);
  };

  const handleSubmit = async () => {
    if (error) return;
    try {
      if (expense) {
        await updateExpense.mutateAsync({
          id: expense.id,
          data: {
            labelId: effectiveLabelId,
            supplierId: supplierId || null,
            purchaseOrderId: purchaseOrderId || null,
            description: description.trim() || null,
            date,
            total: numericTotal,
          },
        });
        toast.success("Gasto actualizado");
      } else {
        const created = await createExpense.mutateAsync({
          labelId: effectiveLabelId,
          supplierId: supplierId || undefined,
          purchaseOrderId: purchaseOrderId || undefined,
          description: description.trim() || undefined,
          date,
          total: numericTotal,
          payments: rows
            .filter((row) => (Number(row.amount) || 0) > 0)
            .map((row) => ({
              amount: Number(row.amount),
              method: row.method,
              date: row.date,
            })),
        });
        if (pendingReceiptFile) {
          try {
            await uploadReceipt.mutateAsync({
              id: created.id,
              file: pendingReceiptFile,
            });
          } catch (err) {
            toast.error(
              getApiErrorMessage(
                err,
                "El gasto se creó pero no se pudo subir el comprobante",
              ),
            );
          }
        }
        toast.success("Gasto registrado");
      }
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "No se pudo guardar el gasto"));
    }
  };

  const updateRow = (tempId: string, patch: Partial<PaymentRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row)),
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={expense ? "Editar gasto" : "Nuevo gasto"}
      size="lg"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column: expense data */}
        <div className="space-y-3.5">
          <BentoSelect
            label="Grupo"
            value={effectiveGroupId}
            disabled={isGroupsLoading}
            onChange={(value) => {
              setGroupId(value);
              setLabelId("");
            }}
            options={[
              { value: "", label: isGroupsLoading ? "Cargando grupos..." : "Selecciona un grupo" },
              ...groups
                .filter((group) => group.active)
                .map((group) => ({ value: group.id, label: group.name })),
            ]}
          />

          <BentoSelect
            label="Etiqueta"
            value={effectiveLabelId}
            disabled={isGroupsLoading || !effectiveGroupId}
            onChange={(value) => {
              const belongsToGroup = labelOptions.some((label) => label.value === value);
              setLabelId(belongsToGroup ? value : "");
            }}
            options={[
              {
                value: "",
                label: isGroupsLoading
                  ? "Cargando etiquetas..."
                  : !effectiveGroupId
                    ? "Selecciona un grupo primero"
                    : labelOptions.length
                      ? "Selecciona una etiqueta"
                      : "No hay etiquetas disponibles",
              },
              ...labelOptions,
            ]}
          />

          <BentoSelect
            label="Proveedor"
            value={supplierId}
            onChange={(value) => setSupplierId(value)}
            options={[
              { value: "", label: "Sin proveedor" },
              ...suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            ]}
          />

          <BentoSelect
            label="Orden de compra"
            value={purchaseOrderId}
            onChange={(value) => setPurchaseOrderId(value)}
            options={[
              { value: "", label: "Sin orden de compra" },
              ...orders.map((order) => ({
                value: order.id,
                label: `OC-${order.orderNumber}`,
              })),
            ]}
          />

          <div>
            <label
              htmlFor={`${uid}-date`}
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Fecha
            </label>
            <input
              id={`${uid}-date`}
              type="date"
              aria-label="Fecha"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-[38px] rounded-lg border border-border/70 bg-muted/30 px-3 text-xs font-mono tabular-nums text-foreground focus:outline-none focus:border-border focus:bg-background transition-colors"
            />
          </div>

          <CurrencyInput
            id={`${uid}-total`}
            label="Total (COP)"
            placeholder="Total del gasto"
            value={total}
            onChange={(value) => setTotal(value === 0 ? "" : String(value))}
          />

          <div>
            <label
              htmlFor={`${uid}-description`}
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Descripción
            </label>
            <textarea
              id={`${uid}-description`}
              rows={3}
              placeholder="Descripción (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:bg-background resize-none transition-colors"
            />
          </div>
        </div>

        {/* Right column: payments + receipt */}
        <div className="space-y-4">
          {/* Edit mode: registered payments overview */}
          {expense && (
            <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-2xs">
              <div className="px-3.5 py-2.5 border-b border-border/60 bg-muted/30 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Pagos registrados ({expense.payments?.length ?? 0})
                </span>
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatCurrency(existingPaymentsSum)}
                </span>
              </div>
              <div className="p-3 space-y-1.5 max-h-44 overflow-y-auto scrollbar-app pr-1">
                {(expense.payments ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">
                    No hay pagos registrados aún.
                  </p>
                ) : (
                  (expense.payments ?? []).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-muted/20 border border-border/40 text-xs font-mono tabular-nums"
                    >
                      <span className="font-medium text-foreground">
                        {PAYMENT_METHOD_OPTIONS.find((m) => m.value === p.method)?.label || p.method}
                      </span>
                      <span className="font-semibold text-foreground">
                        {formatCurrency(Number(p.amount))}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Create mode: interactive payments list */}
          {!expense && (
            <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-2xs">
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    Pagos
                  </span>
                  <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60 tabular-nums">
                    {rows.length} {rows.length === 1 ? "abono" : "abonos"}
                  </span>
                </div>
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  onClick={handleAddRow}
                  className="h-7 text-xs px-2"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar pago
                </Button>
              </div>

              <div className="p-3 space-y-2.5">
                {/* Scrollable payments list with bounded height */}
                <div
                  ref={paymentsListRef}
                  className="max-h-[260px] overflow-y-auto space-y-2.5 pr-1 scrollbar-app"
                >
                  {rows.map((row) => (
                    <div
                      key={row.tempId}
                      className="space-y-2 p-2.5 rounded-lg border border-border/50 bg-muted/20"
                    >
                      <CurrencyInput
                        id={`${uid}-amount-${row.tempId}`}
                        label="Valor"
                        placeholder="Valor del pago"
                        value={row.amount}
                        onChange={(value) =>
                          updateRow(row.tempId, {
                            amount: value === 0 ? "" : String(value),
                          })
                        }
                      />
                      <div className="flex items-end gap-2">
                        <BentoSelect
                          label="Método"
                          value={row.method}
                          onChange={(value) =>
                            updateRow(row.tempId, {
                              method: value as ExpensePayment["method"],
                            })
                          }
                          className="flex-1"
                          options={PAYMENT_METHOD_OPTIONS}
                        />
                        <div className="flex-1">
                          <label
                            htmlFor={`${uid}-paydate-${row.tempId}`}
                            className="mb-1 block text-xs font-medium text-muted-foreground"
                          >
                            Fecha pago
                          </label>
                          <input
                            id={`${uid}-paydate-${row.tempId}`}
                            type="date"
                            aria-label="Fecha del pago"
                            value={row.date}
                            onChange={(e) =>
                              updateRow(row.tempId, { date: e.target.value })
                            }
                            className="w-full h-[38px] rounded-lg border border-border/70 bg-card px-2.5 text-xs font-mono tabular-nums text-foreground focus:outline-none focus:border-border transition-colors"
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Eliminar pago"
                          onClick={() =>
                            setRows((prev) =>
                              prev.filter((r) => r.tempId !== row.tempId),
                            )
                          }
                          disabled={rows.length === 1}
                          className="h-9 w-9 mb-0.5 rounded-lg flex items-center justify-center shrink-0 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-border/50 flex items-center justify-between shrink-0">
                  <span className="text-xs text-muted-foreground">Total de pagos:</span>
                  <span className="font-semibold font-mono text-foreground tabular-nums text-sm">
                    {formatCurrency(paymentsSum)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Comprobante
            </p>
            <div className="max-w-[220px]">
              {expense ? (
                <ImageUpload
                  value={expense.receiptUrl ?? undefined}
                  onChange={() => {}}
                  onUpload={async (file) => {
                    const updated = await uploadReceipt.mutateAsync({
                      id: expense.id,
                      file,
                    });
                    return updated.receiptUrl ?? "";
                  }}
                />
              ) : (
                <ImageUpload
                  onChange={() => {}}
                  onUpload={(file) => {
                    setPendingReceiptFile(file);
                    return Promise.resolve(URL.createObjectURL(file));
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {/* Sticky footer ensuring buttons never get buried */}
      <div className="sticky bottom-0 bg-card/95 backdrop-blur-xs flex justify-end gap-2 pt-3 pb-1 border-t border-border/60 mt-4 z-10">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!!error}
          loading={createExpense.isPending || updateExpense.isPending}
        >
          {expense ? "Guardar cambios" : "Registrar gasto"}
        </Button>
      </div>
    </Modal>
  );
}
