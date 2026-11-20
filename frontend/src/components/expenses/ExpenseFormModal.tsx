"use client";

import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { ImageUpload } from "@/components/ui/ImageUpload";
import {
  invalidateExpenseData,
  useCreateExpense,
  useExpenseGroups,
  useUpdateExpense,
  useUploadExpenseReceipt,
} from "@/hooks/useExpenses";
import { useSuppliers } from "@/hooks/useSuppliers";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import {
  formatCurrency,
  formatDate,
  getBogotaDateInputValue,
} from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { Expense, ExpensePayment } from "@/types";

/**
 * An expense may only be linked to an order that stands for merchandise on its
 * way or already received. The reports treat every linked expense as cost of
 * goods, so a draft or cancelled order would quietly pull an unrelated expense
 * out of the operating expenses.
 */
const LINKABLE_ORDER_STATUSES = new Set(["PENDING", "PARTIAL_RECEIVED", "RECEIVED"]);

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
  const queryClient = useQueryClient();
  const paymentsListRef = useRef<HTMLDivElement>(null);

  // The form owns the invalidation: a create followed by a receipt upload is two
  // requests but one save, so the expense queries refresh once, at the end.
  const createExpense = useCreateExpense({ invalidate: false });
  const updateExpense = useUpdateExpense({ invalidate: false });
  const uploadReceipt = useUploadExpenseReceipt({ invalidate: false });

  /**
   * One busy state for the whole submit. A create plus a receipt upload used to
   * leave the footer looking idle for as long as the upload took; now the button
   * names the step and nothing in the form can be changed, re-submitted or
   * dismissed until both requests have settled.
   */
  const [isBusy, setIsBusy] = useState(false);
  const [submitStep, setSubmitStep] = useState<"saving" | "uploading">("saving");
  const isUploading = isBusy && submitStep === "uploading";

  const { data: groupsData, isLoading: isGroupsLoading } = useExpenseGroups();
  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });

  const groups = groupsData ?? [];
  const suppliers = suppliersData?.data ?? [];

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

  // The order list is only meaningful once a supplier anchors it. The server
  // filters by supplier; without one it would send the organization's whole
  // history for nothing, so only a single row is requested then.
  const { data: ordersData } = usePurchaseOrders({
    supplierId: supplierId || undefined,
    limit: supplierId ? 200 : 1,
  });

  const orders = ordersData?.data ?? [];

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

  /**
   * Only the chosen supplier's linkable orders, newest first. The server already
   * filters by supplier, but `keepPreviousData` keeps the previous supplier's
   * rows on screen while the next request lands, so the supplier is checked here
   * too. The status has no multi-value filter on the endpoint, so it is applied
   * on this side.
   */
  const orderOptions = [...orders]
    .filter(
      (order) =>
        order.supplierId === supplierId && LINKABLE_ORDER_STATUSES.has(order.status),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .map((order) => ({
      value: order.id,
      label: `OC-${order.orderNumber} · ${formatDate(order.createdAt)} · ${formatCurrency(Number(order.total))}`,
    }));

  // A legacy expense can carry an order that no longer matches the selected
  // supplier or its status. Keeping it as its own option shows the real link
  // instead of blanking it behind "Sin orden de compra".
  const linkedOrderOption =
    purchaseOrderId && !orderOptions.some((option) => option.value === purchaseOrderId)
      ? [
          {
            value: purchaseOrderId,
            label: expense?.purchaseOrder
              ? `OC-${expense.purchaseOrder.orderNumber} · vínculo actual`
              : "Vínculo actual",
          },
        ]
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
    if (error || isBusy) return;
    setIsBusy(true);
    setSubmitStep("saving");
    let saved = false;

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
        saved = true;
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
        // The expense exists from here on: a failed receipt attach must never
        // lead to a retry that creates it a second time.
        saved = true;
        if (pendingReceiptFile) {
          setSubmitStep("uploading");
          try {
            await uploadReceipt.mutateAsync({
              id: created.id,
              file: pendingReceiptFile,
            });
            toast.success("Gasto registrado");
          } catch (err) {
            toast.error(
              getApiErrorMessage(
                err,
                "El gasto se registró, pero no se pudo subir el comprobante. Puedes adjuntarlo después desde la lista",
              ),
            );
          }
        } else {
          toast.success("Gasto registrado");
        }
      }
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "No se pudo guardar el gasto"));
    } finally {
      if (saved) invalidateExpenseData(queryClient);
      setIsBusy(false);
      setSubmitStep("saving");
    }
  };

  /** Escape, the backdrop and the header button all route here. */
  const requestClose = () => {
    if (isBusy) return;
    onClose();
  };

  const updateRow = (tempId: string, patch: Partial<PaymentRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row)),
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={expense ? "Editar gasto" : "Nuevo gasto"}
      size="lg"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column: expense data */}
        <div className="space-y-3.5">
          <Select
            label="Grupo"
            value={effectiveGroupId}
            disabled={isGroupsLoading || isBusy}
            onChange={(value) => {
              setGroupId(value);
              setLabelId("");
            }}
            options={[
              { value: "", label: isGroupsLoading ? "Cargando grupos…" : "Selecciona un grupo" },
              ...groups
                .filter((group) => group.active)
                .map((group) => ({ value: group.id, label: group.name })),
            ]}
          />

          <Select
            label="Etiqueta"
            value={effectiveLabelId}
            disabled={isGroupsLoading || !effectiveGroupId || isBusy}
            onChange={(value) => {
              const belongsToGroup = labelOptions.some((label) => label.value === value);
              setLabelId(belongsToGroup ? value : "");
            }}
            options={[
              {
                value: "",
                label: isGroupsLoading
                  ? "Cargando etiquetas…"
                  : !effectiveGroupId
                    ? "Selecciona un grupo primero"
                    : labelOptions.length
                      ? "Selecciona una etiqueta"
                      : "No hay etiquetas disponibles",
              },
              ...labelOptions,
            ]}
          />

          <Select
            label="Proveedor"
            value={supplierId}
            disabled={isBusy}
            onChange={(value) => {
              setSupplierId(value);
              // The order link is only kept when the new supplier still owns it.
              const linkedSupplierId = orders.find(
                (order) => order.id === purchaseOrderId,
              )?.supplierId;
              if (purchaseOrderId && linkedSupplierId !== value) {
                setPurchaseOrderId("");
              }
            }}
            options={[
              { value: "", label: "Sin proveedor" },
              ...suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            ]}
          />

          <div>
            <Select
              label="Orden de compra"
              value={purchaseOrderId}
              disabled={!supplierId || isBusy}
              onChange={(value) => setPurchaseOrderId(value)}
              options={[
                { value: "", label: "Sin orden de compra" },
                ...orderOptions,
                ...linkedOrderOption,
              ]}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {supplierId
                ? "Al ligarla, este gasto cuenta como pago de mercancía y no como gasto operativo."
                : "Elige un proveedor para ligar una orden de compra."}
            </p>
          </div>

          <div>
            <label
              htmlFor={`${uid}-date`}
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Fecha
            </label>
            <Input
              id={`${uid}-date`}
              type="date"
              aria-label="Fecha"
              value={date}
              disabled={isBusy}
              onChange={(e) => setDate(e.target.value)}
              className="tabular-nums"
            />
          </div>

          <CurrencyInput
            id={`${uid}-total`}
            label="Total (COP)"
            placeholder="Total del gasto"
            value={total}
            disabled={isBusy}
            onChange={(value) => setTotal(value === 0 ? "" : String(value))}
          />

          <div>
            <label
              htmlFor={`${uid}-description`}
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Descripción
            </label>
            <Input
              textarea
              id={`${uid}-description`}
              rows={3}
              placeholder="Descripción (opcional)"
              value={description}
              disabled={isBusy}
              onChange={(e) => setDescription(e.target.value)}
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
                <span className="text-xs font-medium text-success-text tabular-nums">
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
                      className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-muted/40 text-xs tabular-nums"
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
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60 tabular-nums">
                    {rows.length} {rows.length === 1 ? "abono" : "abonos"}
                  </span>
                </div>
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  onClick={handleAddRow}
                  disabled={isBusy}
                  className="text-xs px-2"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar pago
                </Button>
              </div>

              <div className="p-3 space-y-2">
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
                        disabled={isBusy}
                        onChange={(value) =>
                          updateRow(row.tempId, {
                            amount: value === 0 ? "" : String(value),
                          })
                        }
                      />
                      <div className="flex items-end gap-2">
                        <Select
                          label="Método"
                          value={row.method}
                          disabled={isBusy}
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
                          <Input
                            id={`${uid}-paydate-${row.tempId}`}
                            type="date"
                            aria-label="Fecha del pago"
                            value={row.date}
                            disabled={isBusy}
                            onChange={(e) =>
                              updateRow(row.tempId, { date: e.target.value })
                            }
                            className="tabular-nums"
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
                          disabled={rows.length === 1 || isBusy}
                          className="h-9 w-9 mb-0.5 rounded-lg flex items-center justify-center shrink-0 text-muted-foreground hover:text-danger-text hover:bg-danger/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-border/50 flex items-center justify-between shrink-0">
                  <span className="text-xs text-muted-foreground">Total de pagos:</span>
                  <span className="font-semibold text-foreground tabular-nums text-sm">
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
                    // This upload is its own save, so it refreshes right away.
                    invalidateExpenseData(queryClient);
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
        <p className="mt-4 text-xs font-medium text-danger-text">{error}</p>
      )}

      {/* Sticky footer ensuring buttons never get buried */}
      <div className="sticky bottom-0 bg-card flex justify-end gap-2 pt-3 pb-[max(0.25rem,var(--safe-bottom))] border-t border-border/60 mt-4 z-10">
        <Button
          type="button"
          variant="secondary"
          onClick={requestClose}
          disabled={isBusy}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!!error || isBusy}
          loading={isBusy}
        >
          {isUploading
            ? "Subiendo comprobante…"
            : isBusy
              ? "Guardando gasto…"
              : expense
                ? "Guardar cambios"
                : "Registrar gasto"}
        </Button>
      </div>
    </Modal>
  );
}
