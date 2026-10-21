"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSuppliers } from "@/hooks/useSuppliers";
import {
  useDuplicateExpense,
  useExpenseGroups,
  useExpenses,
  useExpenseSummary,
  useUploadExpenseReceipt,
} from "@/hooks/useExpenses";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { api, getApiErrorMessage } from "@/lib/api";
import { formatCurrency, formatDate, getBogotaDateInputValue } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { FilterBar } from "@/components/ui/FilterBar";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ExpenseStatusBadge } from "@/components/expenses/ExpenseStatusBadge";
import { ExpenseSummaryCards } from "@/components/expenses/ExpenseSummaryCards";
import { DynamicFallback } from "@/components/ui/DynamicFallback";
import { prefetchOnIdle } from "@/lib/prefetch";
import {
  Copy,
  Eye,
  History,
  Pencil,
  Plus,
  Upload,
  Wallet,
  Download,
} from "lucide-react";
import { chipStyles } from "@/lib/chipStyles";
import { hasAnyRole } from "@/lib/auth";
import type { Expense, ExpenseStatus } from "@/types";
import { ExpenseTaxonomyModal } from "@/components/expenses/ExpenseTaxonomyModal";

// S1 code splitting (#98): the four expense modals are heavy components used
// only on this page; they load as separate chunks on first open and are
// prefetched once the browser is idle after mount.
const loadExpenseFormModal = () =>
  import("@/components/expenses/ExpenseFormModal").then((m) => ({
    default: m.ExpenseFormModal,
  }));
const loadAddPaymentModal = () =>
  import("@/components/expenses/AddPaymentModal").then((m) => ({
    default: m.AddPaymentModal,
  }));
const loadHistoryModal = () =>
  import("@/components/expenses/HistoryModal").then((m) => ({
    default: m.HistoryModal,
  }));
const loadExpenseDetailModal = () =>
  import("@/components/expenses/ExpenseDetailModal").then((m) => ({
    default: m.ExpenseDetailModal,
  }));

const ExpenseFormModal = dynamic(loadExpenseFormModal, {
  loading: () => <DynamicFallback />,
});
const AddPaymentModal = dynamic(loadAddPaymentModal, {
  loading: () => <DynamicFallback />,
});
const HistoryModal = dynamic(loadHistoryModal, {
  loading: () => <DynamicFallback />,
});
const ExpenseDetailModal = dynamic(loadExpenseDetailModal, {
  loading: () => <DynamicFallback />,
});

const STATUS_OPTIONS: Array<{ value: "" | ExpenseStatus; label: string }> = [
  { value: "", label: "Todos los estados" },
  { value: "PARTIAL", label: "Parcial" },
  { value: "PAID", label: "Pagado" },
];

export default function ExpensesPage() {
  const toast = useToast();
  const { user } = useAuth();

  // Warm the lazily loaded modal chunks once idle (S1 code splitting).
  useEffect(
    () =>
      prefetchOnIdle([
        loadExpenseFormModal,
        loadAddPaymentModal,
        loadHistoryModal,
        loadExpenseDetailModal,
      ]),
    [],
  );

  const [month, setMonth] = useState(() =>
    getBogotaDateInputValue().slice(0, 7),
  );
  const [labelId, setLabelId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<"" | ExpenseStatus>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exportFormat, setExportFormat] = useState<"excel" | "csv">("excel");
  const [showExportSection, setShowExportSection] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [paymentExpense, setPaymentExpense] = useState<Expense | null>(null);
  const [historyExpense, setHistoryExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<Expense | null>(null);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);

  const { data: summary } = useExpenseSummary(month);
  const { data: groupsData } = useExpenseGroups();
  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data, isLoading } = useExpenses({
    page,
    limit: 15,
    month,
    labelId: labelId || undefined,
    supplierId: supplierId || undefined,
    status: status || undefined,
    search: search.trim() || undefined,
  });

  const duplicateExpense = useDuplicateExpense();
  const uploadReceipt = useUploadExpenseReceipt();

  const expenses = data?.data ?? [];
  const meta = data?.meta;
  const groups = groupsData ?? [];
  const labels = groups.flatMap((group) => (group.labels ?? []).filter((label) => label.active));
  const suppliers = suppliersData?.data ?? [];

  const hasFilters = !!labelId || !!supplierId || !!status || !!search;

  const clearFilters = () => {
    setPage(1);
    setLabelId("");
    setSupplierId("");
    setStatus("");
    setSearch("");
  };

  const exportRange = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    if (!year || !monthNumber) {
      return {};
    }
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
      startDate: `${month}-01`,
      endDate: `${month}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [month]);

  const handleExport = async () => {
    try {
      await api.exportData("/exports/expenses", {
        format: exportFormat,
        type: "expenses",
        ...exportRange,
      });
      toast.success("Exportación generada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al exportar gastos"));
    }
  };

  const handleDuplicate = async () => {
    if (!duplicateTarget) return;
    try {
      await duplicateExpense.mutateAsync(duplicateTarget.id);
      toast.success("Gasto duplicado");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo duplicar el gasto"));
    }
  };

  const handleReceiptUpload = async (expense: Expense, file: File) => {
    try {
      await uploadReceipt.mutateAsync({ id: expense.id, file });
      toast.success("Comprobante subido");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo subir el comprobante"));
    }
  };

  const openCreate = () => {
    setEditingExpense(null);
    setFormOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setFormOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 lg:space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-1 h-7 rounded-full bg-primary shrink-0" />
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
                Salidas
              </h1>
              {meta && (
                <span
                  className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${chipStyles.primary}`}
                >
                  {meta.total} registros
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-4">
              Registra los gastos y pagos de tu negocio
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setShowExportSection((current) => !current)}
              className="shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              {showExportSection ? "Ocultar exportación" : "Exportar"}
            </Button>
            <Button type="button" onClick={openCreate} className="shrink-0">
              <Plus className="w-4 h-4" /> Nuevo gasto
            </Button>
            {hasAnyRole(user?.role, ["ADMIN"]) && <Button type="button" variant="secondary" onClick={() => setTaxonomyOpen(true)} className="shrink-0">Gestionar categorías</Button>}
          </div>
        </div>

        {showExportSection && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-xs">
            <span className="flex-1 text-sm text-muted-foreground">
              Exporta las salidas del mes seleccionado.
            </span>
            <BentoSelect
              value={exportFormat}
              onChange={(value) => setExportFormat(value as "excel" | "csv")}
              className="w-44"
              placeholder="Formato de exportación"
              options={[
                { value: "excel", label: "Excel" },
                { value: "csv", label: "CSV" },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleExport}
              className="shrink-0"
            >
              <Download className="w-3.5 h-3.5" /> Exportar archivo
            </Button>
          </div>
        )}

        <ExpenseSummaryCards month={month} summary={summary} />

        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Buscar por descripción..."
          filterControls={
            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
              <input
                type="month"
                aria-label="Mes"
                value={month}
                onChange={(e) => {
                  setPage(1);
                  setMonth(e.target.value);
                }}
                className="h-8 px-2 rounded-lg text-xs font-semibold bg-muted/40 border border-border/60 text-foreground focus:outline-none focus:border-primary/50 w-full sm:w-auto"
              />
              <BentoSelect
                value={labelId}
                onChange={(value) => {
                  setPage(1);
                  setLabelId(value);
                }}
                className="w-full sm:w-52"
                placeholder="Todas las etiquetas"
                options={[
                  { value: "", label: "Todas las etiquetas" },
                  ...labels.map((label) => ({
                    value: label.id,
                    label: label.name,
                  })),
                ]}
              />
              <BentoSelect
                value={supplierId}
                onChange={(value) => {
                  setPage(1);
                  setSupplierId(value);
                }}
                className="w-full sm:w-52"
                placeholder="Todos los proveedores"
                options={[
                  { value: "", label: "Todos los proveedores" },
                  ...suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.name,
                  })),
                ]}
              />
              <BentoSelect
                value={status}
                onChange={(value) => {
                  setPage(1);
                  setStatus(value as "" | ExpenseStatus);
                }}
                className="w-full sm:w-44"
                placeholder="Todos los estados"
                options={STATUS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60 transition-colors"
                >
                  Limpiar
                </button>
              )}
            </div>
          }
        />

        {isLoading ? (
          <LoadingState
            icon={<Wallet className="w-4 h-4 text-primary/50" />}
            message="Cargando salidas..."
          />
        ) : (
          <>
            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {expenses.length === 0 ? (
                <EmptyState
                  icon={
                    <Wallet className="w-6 h-6 text-muted-foreground/30" />
                  }
                  title="No hay salidas registradas"
                />
              ) : (
                expenses.map((expense) => {
                  const isPaid = expense.status === "PAID";
                  const paymentButtonLabel = isPaid
                    ? "La salida ya está pagada"
                    : "Agregar pago";

                  return (
                    <div
                      key={expense.id}
                      className="rounded-2xl border border-accent/30 bg-card p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-foreground truncate max-w-[200px]">
                          {expense.label?.group?.name ? `${expense.label.group.name} / ` : ""}{expense.label?.name ?? "Salida general"}
                        </span>
                        <ExpenseStatusBadge status={expense.status} />
                      </div>

                      {expense.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {expense.description}
                        </p>
                      )}

                      <div className="space-y-1 text-xs">
                        {expense.supplier?.name && (
                          <div className="flex justify-between items-center text-muted-foreground">
                            <span>Proveedor</span>
                            <span className="font-semibold text-foreground truncate max-w-[180px]">
                              {expense.supplier.name}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>Fecha</span>
                          <span className="font-mono">{formatDate(expense.date)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                        <div>
                          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Total</p>
                          <p className="stat-number text-base font-bold text-foreground">
                            {formatCurrency(Number(expense.total))}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            aria-label="Ver detalle"
                            title="Ver detalle"
                            onClick={() => setDetailExpense(expense)}
                            className="p-1.5 h-8 w-8"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            aria-label={paymentButtonLabel}
                            title={paymentButtonLabel}
                            disabled={isPaid}
                            onClick={() => setPaymentExpense(expense)}
                            className="p-1.5 h-8 w-8"
                          >
                            <Wallet className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            aria-label="Ver historial"
                            title="Ver historial"
                            onClick={() => setHistoryExpense(expense)}
                            className="p-1.5 h-8 w-8"
                          >
                            <History className="w-4 h-4" />
                          </Button>
                          <label
                            className="inline-flex items-center justify-center p-1.5 h-8 w-8 rounded-lg cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="Subir comprobante"
                          >
                            <input
                              type="file"
                              accept="image/*"
                              aria-label="Subir comprobante"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  void handleReceiptUpload(expense, file);
                                }
                              }}
                            />
                            <Upload className="w-4 h-4" />
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block rounded-3xl border border-accent/30 bg-accent/10 overflow-hidden">
              <div className="overflow-x-auto">
                <Table variant="accent" className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell
                        as="th"
                        className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Fecha
                      </TableCell>
                      <TableCell
                        as="th"
                        className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                         Grupo / etiqueta
                      </TableCell>
                      <TableCell
                        as="th"
                        className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Descripción
                      </TableCell>
                      <TableCell
                        as="th"
                        className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Proveedor
                      </TableCell>
                      <TableCell
                        as="th"
                        className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Estado
                      </TableCell>
                      <TableCell
                        as="th"
                        className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Total
                      </TableCell>
                      <TableCell
                        as="th"
                        className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Acciones
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {expenses.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-14">
                          <EmptyState
                            icon={
                              <Wallet className="w-6 h-6 text-muted-foreground/30" />
                            }
                            title="No hay salidas registradas"
                          />
                        </td>
                      </tr>
                    ) : (
                      expenses.map((expense) => {
                        const isPaid = expense.status === "PAID";
                        const paymentButtonLabel = isPaid
                          ? "La salida ya está pagada"
                          : "Agregar pago";

                        return (
                        <TableRow key={expense.id}>
                          <TableCell className="text-muted-foreground whitespace-nowrap font-mono">
                            {formatDate(expense.date)}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-semibold text-foreground">
                              {expense.label?.group?.name ? `${expense.label.group.name} / ` : ""}{expense.label?.name ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate">
                            <span className="text-xs text-muted-foreground">
                              {expense.description ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate">
                            <span className="text-xs font-semibold text-foreground">
                              {expense.supplier?.name ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <ExpenseStatusBadge status={expense.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="stat-number text-sm font-bold text-foreground">
                              {formatCurrency(Number(expense.total))}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                aria-label="Ver detalle"
                                title="Ver detalle"
                                onClick={() => setDetailExpense(expense)}
                                className="p-1.5 h-7 w-7"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                aria-label={paymentButtonLabel}
                                title={paymentButtonLabel}
                                disabled={isPaid}
                                onClick={() => setPaymentExpense(expense)}
                                className="p-1.5 h-7 w-7"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                aria-label="Ver historial"
                                title="Ver historial"
                                onClick={() => setHistoryExpense(expense)}
                                className="p-1.5 h-7 w-7"
                              >
                                <History className="w-3.5 h-3.5" />
                              </Button>
                              <label
                                className="inline-flex items-center justify-center p-1.5 h-7 w-7 rounded-lg cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted"
                                title="Subir comprobante"
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  aria-label="Subir comprobante"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      handleReceiptUpload(expense, file);
                                    }
                                    e.target.value = "";
                                  }}
                                />
                                <Upload className="w-3.5 h-3.5" />
                              </label>
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                aria-label="Duplicar gasto"
                                title="Duplicar gasto"
                                onClick={() => setDuplicateTarget(expense)}
                                className="p-1.5 h-7 w-7"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                aria-label="Editar gasto"
                                title="Editar gasto"
                                onClick={() => openEdit(expense)}
                                className="p-1.5 h-7 w-7"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        );
                      })
                    )}
                  </tbody>
                </Table>
              </div>
            </div>

            {meta && meta.totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                itemLabel="salida"
              />
            )}
          </>
        )}
      </div>

      {formOpen && (
        <ExpenseFormModal
          isOpen
          expense={editingExpense}
          onClose={() => {
            setFormOpen(false);
            setEditingExpense(null);
          }}
        />
      )}

      {paymentExpense && (
        <AddPaymentModal
          isOpen
          expense={paymentExpense}
          onClose={() => setPaymentExpense(null)}
        />
      )}

      {historyExpense && (
        <HistoryModal
          isOpen
          expense={historyExpense}
          onClose={() => setHistoryExpense(null)}
        />
      )}

      {detailExpense && (
        <ExpenseDetailModal
          isOpen
          expense={detailExpense}
          onClose={() => setDetailExpense(null)}
        />
      )}

      <ExpenseTaxonomyModal isOpen={taxonomyOpen} onClose={() => setTaxonomyOpen(false)} />

      <ConfirmDialog
        isOpen={!!duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onConfirm={handleDuplicate}
        title="Duplicar gasto"
        message="Se creará una copia del gasto con la fecha de hoy y sus pagos."
        confirmText="Sí, duplicar"
      />
    </DashboardLayout>
  );
}
