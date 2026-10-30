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
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { BentoSelect } from "@/components/ui/BentoSelect";
import {
  FilterBar,
  FilterClearButton,
} from "@/components/ui/FilterBar";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
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
  Download,
  Eye,
  FileCheck,
  History,
  Pencil,
  Plus,
  Settings2,
  Upload,
  Wallet,
} from "lucide-react";
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
  const [viewMode, setViewMode] = usePersistedViewMode("expenses");
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
    limit: viewMode === "grid" ? 9 : 10,
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
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-4">
        <PageHeader
          title="Salidas"
          subtitle="Registra los gastos y pagos de tu negocio"
          count={
            meta
              ? `${meta.total} ${meta.total === 1 ? "registro" : "registros"}`
              : undefined
          }
          actions={
            <>
              {hasAnyRole(user?.role, ["ADMIN"]) && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setTaxonomyOpen(true)}
                  className="flex-1 sm:flex-none"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Gestionar categorías
                </Button>
              )}
              <Button
                variant="secondary"
                type="button"
                onClick={() => setShowExportSection((current) => !current)}
                className="flex-1 sm:flex-none"
              >
                <Download className="w-3.5 h-3.5" />
                {showExportSection ? "Ocultar exportación" : "Exportar"}
              </Button>
              <Button
                type="button"
                onClick={openCreate}
                className="w-full sm:w-auto"
              >
                <Plus className="w-4 h-4" /> Nuevo gasto
              </Button>
            </>
          }
        />

        {/* Collapsible Export Section */}
        {showExportSection && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs">
            <span className="flex-1 text-xs text-muted-foreground">
              Exporta las salidas del mes seleccionado en formato Excel o CSV.
            </span>
            <div className="flex items-center gap-2">
              <BentoSelect
                value={exportFormat}
                onChange={(value) => setExportFormat(value as "excel" | "csv")}
                className="w-36"
                placeholder="Formato"
                options={[
                  { value: "excel", label: "Excel (.xlsx)" },
                  { value: "csv", label: "CSV (.csv)" },
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
          </div>
        )}

        {/* Monthly Summary Cards */}
        <ExpenseSummaryCards month={month} summary={summary} />

        {/* Filters */}
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Buscar por descripción..."
          filterControls={
            <>
              <input
                type="month"
                aria-label="Mes"
                value={month}
                onChange={(e) => {
                  setPage(1);
                  setMonth(e.target.value);
                }}
                className="h-[38px] px-3 rounded-lg text-xs font-mono font-medium bg-muted/40 border border-transparent focus:border-border/70 focus:bg-background text-foreground focus:outline-none tabular-nums transition-colors w-full sm:w-auto cursor-pointer"
              />
              <BentoSelect
                value={labelId}
                onChange={(value) => {
                  setPage(1);
                  setLabelId(value);
                }}
                className="w-full sm:w-44"
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
                className="w-full sm:w-44"
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
                className="w-full sm:w-36"
                placeholder="Todos los estados"
                options={STATUS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
              {hasFilters && <FilterClearButton onClick={clearFilters} />}
              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => {
                  setPage(1);
                  setViewMode(mode);
                }}
              />
            </>
          }
        />

        {isLoading ? (
          <LoadingState
            icon={<Wallet className="w-4 h-4 text-muted-foreground" />}
            message="Cargando salidas..."
          />
        ) : (
          <>
            {/* Mobile Cards (Always visible on mobile) */}
            <div className="md:hidden flex-1 space-y-3">
              {expenses.length === 0 ? (
                <EmptyState
                  icon={<Wallet className="w-5 h-5 text-muted-foreground" />}
                  title="No hay salidas registradas"
                />
              ) : (
                expenses.map((expense) => {
                  const isPaid = expense.status === "PAID";
                  const paymentButtonLabel = isPaid
                    ? "La salida ya está pagada"
                    : "Agregar pago";
                  const paidSum = (expense.payments ?? []).reduce(
                    (acc, p) => acc + (Number(p.amount) || 0),
                    0,
                  );
                  const remaining = Math.max(Number(expense.total) - paidSum, 0);

                  return (
                    <div
                      key={expense.id}
                      className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs space-y-3 hover:border-border transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 truncate">
                          {expense.label?.group?.name && (
                            <span className="text-[11px] font-medium text-muted-foreground truncate">
                              {expense.label.group.name} /
                            </span>
                          )}
                          <span className="font-semibold text-sm text-foreground truncate">
                            {expense.label?.name ?? "Salida general"}
                          </span>
                        </div>
                        <ExpenseStatusBadge status={expense.status} />
                      </div>

                      {expense.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {expense.description}
                        </p>
                      )}

                      <div className="space-y-1.5 text-xs pt-1 border-t border-border/50">
                        {expense.supplier?.name && (
                          <div className="flex justify-between items-center text-muted-foreground">
                            <span>Proveedor</span>
                            <span className="font-medium text-foreground truncate max-w-[180px]">
                              {expense.supplier.name}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>Fecha</span>
                          <span className="font-mono tabular-nums text-foreground">{formatDate(expense.date)}</span>
                        </div>
                        {expense.receiptUrl && (
                          <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <FileCheck className="w-3.5 h-3.5" />
                            <span>Comprobante adjunto</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground">Total</p>
                          <p className="text-sm font-semibold font-mono text-foreground tabular-nums">
                            {formatCurrency(Number(expense.total))}
                          </p>
                          {!isPaid && remaining > 0 && (
                            <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                              Saldo: {formatCurrency(remaining)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Ver detalle"
                            title="Ver detalle"
                            onClick={() => setDetailExpense(expense)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={paymentButtonLabel}
                            title={paymentButtonLabel}
                            disabled={isPaid}
                            onClick={() => setPaymentExpense(expense)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Ver historial"
                            title="Ver historial"
                            onClick={() => setHistoryExpense(expense)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <label
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent cursor-pointer text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
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
                                e.target.value = "";
                              }}
                            />
                            <Upload className="w-3.5 h-3.5" />
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table View */}
            {viewMode === "table" ? (
              <div className="hidden md:block flex-1">
                <div className="h-full rounded-xl border border-border/70 bg-card overflow-hidden shadow-2xs animate-fade-in">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[860px]">
                      <TableHeader>
                        <TableRow>
                          <TableCell as="th" className="w-28">
                            Fecha
                          </TableCell>
                          <TableCell as="th" className="min-w-[170px]">
                            Grupo / etiqueta
                          </TableCell>
                          <TableCell as="th" className="max-w-[220px]">
                            Descripción
                          </TableCell>
                          <TableCell as="th" className="min-w-[160px]">
                            Proveedor
                          </TableCell>
                          <TableCell as="th" className="w-28">
                            Estado
                          </TableCell>
                          <TableCell as="th" className="text-right w-32">
                            Total
                          </TableCell>
                          <TableCell as="th" className="text-right w-48">
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
                                  <Wallet className="w-5 h-5 text-muted-foreground" />
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
                            const paidSum = (expense.payments ?? []).reduce(
                              (acc, p) => acc + (Number(p.amount) || 0),
                              0,
                            );
                            const remaining = Math.max(Number(expense.total) - paidSum, 0);

                            return (
                              <TableRow key={expense.id}>
                                <TableCell className="text-muted-foreground whitespace-nowrap font-mono text-xs tabular-nums">
                                  {formatDate(expense.date)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col max-w-[170px]">
                                    <span className="text-xs font-semibold text-foreground truncate">
                                      {expense.label?.group?.name ? `${expense.label.group.name} / ` : ""}
                                      {expense.label?.name ?? "—"}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-[220px]">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="text-xs text-muted-foreground truncate">
                                      {expense.description ?? "—"}
                                    </span>
                                    {expense.receiptUrl && (
                                      <span
                                        title="Comprobante adjunto"
                                        className="inline-flex shrink-0 items-center text-emerald-600 dark:text-emerald-400"
                                      >
                                        <FileCheck className="w-3.5 h-3.5" />
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-[160px] truncate">
                                  <span className="text-xs font-medium text-foreground truncate block">
                                    {expense.supplier?.name ?? "—"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <ExpenseStatusBadge status={expense.status} />
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-col items-end">
                                    <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                                      {formatCurrency(Number(expense.total))}
                                    </span>
                                    {!isPaid && remaining > 0 && (
                                      <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400 tabular-nums">
                                        Saldo: {formatCurrency(remaining)}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      aria-label="Ver detalle"
                                      title="Ver detalle"
                                      onClick={() => setDetailExpense(expense)}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={paymentButtonLabel}
                                      title={paymentButtonLabel}
                                      disabled={isPaid}
                                      onClick={() => setPaymentExpense(expense)}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                                    >
                                      <Wallet className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Ver historial"
                                      title="Ver historial"
                                      onClick={() => setHistoryExpense(expense)}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                                    >
                                      <History className="w-3.5 h-3.5" />
                                    </button>
                                    <label
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent cursor-pointer text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
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
                                    <button
                                      type="button"
                                      aria-label="Duplicar gasto"
                                      title="Duplicar gasto"
                                      onClick={() => setDuplicateTarget(expense)}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Editar gasto"
                                      title="Editar gasto"
                                      onClick={() => openEdit(expense)}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
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
              </div>
            ) : (
              /* Desktop Grid View */
              <div className="hidden md:grid flex-1 content-start md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-3 stagger-children">
                {expenses.length === 0 ? (
                  <div className="col-span-full py-14">
                    <EmptyState
                      icon={
                        <Wallet className="w-5 h-5 text-muted-foreground" />
                      }
                      title="No hay salidas registradas"
                    />
                  </div>
                ) : (
                  expenses.map((expense) => {
                    const isPaid = expense.status === "PAID";
                    const paymentButtonLabel = isPaid
                      ? "La salida ya está pagada"
                      : "Agregar pago";
                    const paidSum = (expense.payments ?? []).reduce(
                      (acc, p) => acc + (Number(p.amount) || 0),
                      0,
                    );
                    const remaining = Math.max(Number(expense.total) - paidSum, 0);

                    return (
                      <div
                        key={expense.id}
                        className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs space-y-2.5 hover:border-border transition-colors flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 truncate">
                              {expense.label?.group?.name && (
                                <span className="text-[11px] font-medium text-muted-foreground truncate">
                                  {expense.label.group.name} /
                                </span>
                              )}
                              <span className="font-semibold text-sm text-foreground truncate">
                                {expense.label?.name ?? "Salida general"}
                              </span>
                            </div>
                            <ExpenseStatusBadge status={expense.status} />
                          </div>

                          {expense.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {expense.description}
                            </p>
                          )}

                          <div className="space-y-1.5 text-xs pt-1 border-t border-border/50">
                            {expense.supplier?.name && (
                              <div className="flex justify-between items-center text-muted-foreground">
                                <span>Proveedor</span>
                                <span className="font-medium text-foreground truncate max-w-[180px]">
                                  {expense.supplier.name}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between items-center text-muted-foreground">
                              <span>Fecha</span>
                              <span className="font-mono tabular-nums text-foreground">{formatDate(expense.date)}</span>
                            </div>
                            {expense.receiptUrl && (
                              <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                <FileCheck className="w-3.5 h-3.5" />
                                <span>Comprobante adjunto</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2.5 border-t border-border/60 mt-auto">
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground">Total</p>
                            <p className="text-sm font-semibold font-mono text-foreground tabular-nums">
                              {formatCurrency(Number(expense.total))}
                            </p>
                            {!isPaid && remaining > 0 && (
                              <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                                Saldo: {formatCurrency(remaining)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="Ver detalle"
                              title="Ver detalle"
                              onClick={() => setDetailExpense(expense)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={paymentButtonLabel}
                              title={paymentButtonLabel}
                              disabled={isPaid}
                              onClick={() => setPaymentExpense(expense)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                            >
                              <Wallet className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Ver historial"
                              title="Ver historial"
                              onClick={() => setHistoryExpense(expense)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                            <label
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent cursor-pointer text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
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
                                  e.target.value = "";
                                }}
                              />
                              <Upload className="w-3.5 h-3.5" />
                            </label>
                            <button
                              type="button"
                              aria-label="Duplicar gasto"
                              title="Duplicar gasto"
                              onClick={() => setDuplicateTarget(expense)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Editar gasto"
                              title="Editar gasto"
                              onClick={() => openEdit(expense)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {meta && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                pageSize={viewMode === "grid" ? 9 : 10}
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
