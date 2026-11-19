"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  cn,
  formatCurrency,
  formatDateShort,
  getBogotaDateInputValue,
} from "@/lib/utils";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import {
  COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
  COLLECTION_CARD_MIN_WIDTH,
  COLLECTION_GRID_GAP,
  MAX_COLLECTION_PAGE_SIZE,
  MIN_VISIBLE_ROWS,
  remapPageForPageSize,
} from "@/lib/collection-grid";
import { Button } from "@/components/ui/Button";
import { COLLECTION_GRID_CLASSES } from "@/components/ui/collectionGrid";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { Select } from "@/components/ui/Select";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ExpenseStatusBadge } from "@/components/expenses/ExpenseStatusBadge";
import { ExpenseCard, expenseName } from "@/components/expenses/ExpenseCard";
import { ExpenseFilters } from "@/components/expenses/ExpenseFilters";
import { ExpenseSummaryCards } from "@/components/expenses/ExpenseSummaryCards";
import { ExpenseModalFallback } from "@/components/expenses/ExpenseModalFallback";
import { activationProps } from "@/lib/activation";
import { prefetchOnIdle } from "@/lib/prefetch";
import {
  Copy,
  Download,
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
  loading: () => <ExpenseModalFallback />,
});
const AddPaymentModal = dynamic(loadAddPaymentModal, {
  loading: () => <ExpenseModalFallback />,
});
const HistoryModal = dynamic(loadHistoryModal, {
  loading: () => <ExpenseModalFallback />,
});
const ExpenseDetailModal = dynamic(loadExpenseDetailModal, {
  loading: () => <ExpenseModalFallback />,
});

/** Table view: a dense list keeps the page it always had. */
const TABLE_PAGE_SIZE = 10;

/** Card view floor: the fixed card page this list always had. */
const DEFAULT_CARD_PAGE_SIZE = 9;

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

  // Card view fills the viewport: the grid reports how many cards fit, and the
  // table keeps the fixed page it always had.
  const {
    pageSize: gridPageSize,
    containerRef: gridRef,
    footerRef,
    tableRef,
  } = useResponsivePageSize({
    minCardWidth: COLLECTION_CARD_MIN_WIDTH,
    gap: COLLECTION_GRID_GAP,
    rowHeight: COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
    minRows: MIN_VISIBLE_ROWS,
    min: DEFAULT_CARD_PAGE_SIZE,
    max: MAX_COLLECTION_PAGE_SIZE,
    enabled: viewMode === "grid",
  });
  const pageSize = gridPageSize;

  // Re-anchor on the item the user was already looking at when a resize changes
  // the page size, instead of leaving them on a page that now starts elsewhere.
  const previousPageSize = useRef(pageSize);
  useEffect(() => {
    const previous = previousPageSize.current;
    if (previous === pageSize) return;
    previousPageSize.current = pageSize;
    const nextPage = remapPageForPageSize({ page, previousSize: previous, nextSize: pageSize });
    if (nextPage !== page) setPage(nextPage);
  }, [pageSize, page]);

  const { data: summary } = useExpenseSummary(month);
  const { data: groupsData } = useExpenseGroups();
  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const { data, isLoading, isError, error, refetch } = useExpenses({
    page,
    limit: pageSize,
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

  /**
   * One action list for the table row and the cards so every layout offers the
   * same operations through the same overflow menu.
   */
  const actionsFor = (
    expense: Expense,
    isPaid: boolean,
    paymentLabel: string,
  ): RowActionItem[] => [
    {
      label: paymentLabel,
      icon: <Wallet className="w-3.5 h-3.5" aria-hidden="true" />,
      onSelect: () => setPaymentExpense(expense),
      disabled: isPaid,
    },
    {
      label: "Ver historial",
      icon: <History className="w-3.5 h-3.5" aria-hidden="true" />,
      onSelect: () => setHistoryExpense(expense),
    },
    {
      kind: "file",
      label: "Subir comprobante",
      icon: <Upload className="w-3.5 h-3.5" aria-hidden="true" />,
      accept: "image/*",
      onFile: (file) => void handleReceiptUpload(expense, file),
    },
    {
      label: "Duplicar gasto",
      icon: <Copy className="w-3.5 h-3.5" aria-hidden="true" />,
      onSelect: () => setDuplicateTarget(expense),
    },
    {
      label: "Editar gasto",
      icon: <Pencil className="w-3.5 h-3.5" aria-hidden="true" />,
      onSelect: () => openEdit(expense),
    },
  ];

  return (
    <DashboardLayout>
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
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
            <span className="flex-1 text-[13px] text-muted-foreground">
              Exporta las salidas del mes seleccionado en formato Excel o CSV.
            </span>
            <div className="flex items-center gap-2">
              <Select
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

        {/* Monthly summary: one strip, no half-width cards */}
        <ExpenseSummaryCards month={month} summary={summary} />

        {/* One toolbar: search and every filter share the row and the height */}
        <ExpenseFilters
          search={search}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          month={month}
          onMonthChange={(value) => {
            setPage(1);
            setMonth(value);
          }}
          labelId={labelId}
          onLabelChange={(value) => {
            setPage(1);
            setLabelId(value);
          }}
          labels={labels}
          supplierId={supplierId}
          onSupplierChange={(value) => {
            setPage(1);
            setSupplierId(value);
          }}
          suppliers={suppliers}
          status={status}
          onStatusChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          hasFilters={hasFilters}
          onClear={clearFilters}
          viewMode={viewMode}
          onViewModeChange={(mode) => {
            setPage(1);
            setViewMode(mode);
          }}
        />

        {isLoading ? (
          <CardSkeleton count={6} label="Cargando salidas…" />
        ) : isError && !data ? (
          <ErrorState
            message={getApiErrorMessage(error, "No se pudieron cargar las salidas")}
            retryLabel="Reintentar"
            onRetry={() => void refetch()}
            className="min-h-[240px]"
          />
        ) : (
          <>
            {/*
              One collection grid for every card, phone to desktop: the track
              comes from the shared collection token and the grid is hidden from
              `md` up only while the table view is the chosen one.
            */}
            <div
              ref={gridRef}
              className={cn(
                COLLECTION_GRID_CLASSES,
                "flex-1 content-start",
                viewMode === "table" && "md:hidden",
              )}
            >
              {expenses.length === 0 ? (
                <div className="col-span-full py-14">
                  <EmptyState
                    icon={<Wallet className="w-5 h-5 text-muted-foreground" />}
                    title="No hay salidas registradas"
                  />
                </div>
              ) : (
                expenses.map((expense) => {
                  const isPaid = expense.status === "PAID";
                  return (
                    <ExpenseCard
                      key={expense.id}
                      expense={expense}
                      onOpenDetail={() => setDetailExpense(expense)}
                      actions={actionsFor(
                        expense,
                        isPaid,
                        isPaid ? "La salida ya está pagada" : "Agregar pago",
                      )}
                    />
                  );
                })
              )}
            </div>

            {/* Desktop Table View */}
            {viewMode === "table" && (
              <div className="hidden md:block flex-1">
                <div className="h-full rounded-xl border border-border/70 bg-card overflow-hidden shadow-2xs">
                  <div ref={tableRef} className="overflow-x-auto">
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
                          <TableCell as="th" numeric className="w-32">
                            Total
                          </TableCell>
                          <TableCell as="th" numeric className="w-20">
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
                              <TableRow
                                key={expense.id}
                                {...activationProps(
                                  () => setDetailExpense(expense),
                                  `Ver detalle de ${expenseName(expense)}`,
                                )}
                                className="cursor-pointer active:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                              >
                                <TableCell className="text-muted-foreground whitespace-nowrap text-sm tabular-nums">
                                  {formatDateShort(expense.date)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col max-w-[170px]">
                                    <span className="text-sm font-semibold text-foreground truncate">
                                      {expense.label?.group?.name ? `${expense.label.group.name} / ` : ""}
                                      {expense.label?.name ?? "—"}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-[220px]">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="text-[13px] text-muted-foreground truncate">
                                      {expense.description ?? "—"}
                                    </span>
                                    {expense.receiptUrl && (
                                      <span
                                        title="Comprobante adjunto"
                                        className="inline-flex shrink-0 items-center text-success-text"
                                      >
                                        <FileCheck className="w-3.5 h-3.5" />
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-[160px] truncate">
                                  <span className="text-sm font-medium text-foreground truncate block">
                                    {expense.supplier?.name ?? "—"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <ExpenseStatusBadge status={expense.status} />
                                </TableCell>
                                <TableCell numeric>
                                  <div className="flex flex-col items-end">
                                    <span className="text-sm font-semibold text-foreground tabular-nums">
                                      {formatCurrency(Number(expense.total))}
                                    </span>
                                    {!isPaid && remaining > 0 && (
                                      <span className="text-[13px] text-warning-text tabular-nums">
                                        Saldo: {formatCurrency(remaining)}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell numeric>
                                  <div
                                    className="flex justify-end"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <RowActions
                                      label={`Más acciones de ${expenseName(expense)}`}
                                      items={actionsFor(expense, isPaid, paymentButtonLabel)}
                                    />
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
            )}

            {meta && (
              // `contents` keeps the pager a direct flex child (sticky bottom and
              // mt-auto still work) while the sizing hook measures it.
              <div ref={footerRef} className="contents">
                <Pagination
                  currentPage={page}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  totalItems={meta.total}
                  pageSize={pageSize}
                  itemLabel="salida"
                />
              </div>
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
