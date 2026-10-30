"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSales } from "@/hooks/useSales";
import { printReceipt } from "@/hooks/useReceipt";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FilterBar,
  FilterClearButton,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import { Download, Eye, Receipt } from "lucide-react";
import {
  cn,
  formatCurrency,
  formatDateTime,
  getBogotaDateInputValue,
  shiftDateInputValue,
} from "@/lib/utils";
import type { Sale } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";
import { PaymentStateBadge, getPaymentState } from "@/components/sales/PaymentState";

function SalesPageContent() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const isAdmin = hasAnyRole(currentUser?.role, ["ADMIN"]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = usePersistedViewMode("sales");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const customerId = searchParams.get("customerId") ?? "";
  const customerLabel = searchParams.get("customerName") ?? "";

  // Table view sizes itself to the box it actually gets, so the last row never
  // hides behind the paginator and no row is clipped.
  const listRef = useRef<HTMLDivElement>(null);
  const [tableRows, setTableRows] = useState(10);
  const pageSize = viewMode === "grid" ? 9 : tableRows;

  const todayValue = getBogotaDateInputValue();
  const weekStartValue = shiftDateInputValue(todayValue, -6);
  const monthStartValue = shiftDateInputValue(todayValue, -29);
  const isAllDatesActive = !startDate && !endDate;
  const isTodayActive = startDate === todayValue && endDate === todayValue;
  const isWeekActive = startDate === weekStartValue && endDate === todayValue;
  const isMonthActive = startDate === monthStartValue && endDate === todayValue;

  const setAllDates = () => {
    setPage(1);
    setStartDate("");
    setEndDate("");
  };

  const setToday = () => {
    const today = getBogotaDateInputValue();
    setPage(1);
    setStartDate(today);
    setEndDate(today);
  };

  const setThisWeek = () => {
    const today = getBogotaDateInputValue();
    setPage(1);
    setStartDate(shiftDateInputValue(today, -6));
    setEndDate(today);
  };

  const setLast30Days = () => {
    const today = getBogotaDateInputValue();
    setPage(1);
    setStartDate(shiftDateInputValue(today, -29));
    setEndDate(today);
  };

  const { data, isLoading } = useSales({
    page,
    limit: pageSize,
    status: status || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    search: search.trim() || undefined,
    customerId: customerId || undefined,
  });
  const sales = data?.data ?? [];
  const meta = data?.meta;

  // Table view sizes itself to the box it actually gets, so the last row never
  // hides behind the paginator and no row is clipped.
  useEffect(() => {
    const element = listRef.current;
    if (!element || viewMode !== "table") return;
    const observer = new ResizeObserver(() => {
      const rowHeight =
        element.querySelector("tbody tr")?.getBoundingClientRect().height || 53;
      const rows = Math.floor((element.clientHeight - 40) / rowHeight);
      setTableRows((current) =>
        current === rows ? current : Math.max(8, Math.min(30, rows)),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode, isLoading]);

  useEffect(() => {
    if (meta && meta.totalPages > 0 && page > meta.totalPages) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(1);
    }
  }, [meta, page]);

  const handleViewDetails = (sale: Sale) => {
    setSelectedSale(sale);
    setShowDetailModal(true);
  };

  const handlePrintReceipt = async (saleId: string) => {
    try {
      await printReceipt(saleId);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al generar el comprobante"));
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case "COMPLETED":
        return <Badge variant="success">Completada</Badge>;
      case "CANCELLED":
        return <Badge variant="danger">Cancelada</Badge>;
      case "RETURNED_PARTIAL":
        return <Badge variant="warning">Parcial</Badge>;
      default:
        return <Badge variant="default">{s}</Badge>;
    }
  };



  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-5">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Ventas
              </h1>
              {meta && (
                <span className="hidden sm:inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                  {meta.total} registros
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isAdmin ? "Historial de transacciones" : "Mis transacciones"}
            </p>
          </div>
        </div>

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Buscar por N° o cliente..."
          preContent={
            customerId ? (
              <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/35 px-3 py-1.5">
                <Badge variant="secondary" className="max-w-full truncate">
                  Historial de cliente {customerLabel ? `: ${customerLabel}` : "filtrado"}
                </Badge>
                <FilterClearButton
                  label="Quitar filtro"
                  onClick={() => {
                    setPage(1);
                    router.replace("/sales");
                  }}
                />
              </div>
            ) : undefined
          }
          filterControls={
            <>
              <BentoSelect
                value={status}
                onChange={(val) => {
                  setPage(1);
                  setStatus(val);
                }}
                placeholder="Todos los estados"
                className="w-full sm:w-44 shrink-0"
                options={[
                  { value: "", label: "Todos los estados" },
                  { value: "COMPLETED", label: "Completada" },
                  { value: "RETURNED_PARTIAL", label: "Parcial" },
                  { value: "CANCELLED", label: "Cancelada" },
                ]}
              />
              <FilterGroup label="Período">
                <FilterOptionButton active={isAllDatesActive} onClick={setAllDates}>
                  Todas
                </FilterOptionButton>
                <FilterOptionButton active={isTodayActive} onClick={setToday}>
                  Hoy
                </FilterOptionButton>
                <FilterOptionButton active={isWeekActive} onClick={setThisWeek}>
                  7D
                </FilterOptionButton>
                <FilterOptionButton active={isMonthActive} onClick={setLast30Days}>
                  30D
                </FilterOptionButton>
              </FilterGroup>
              {(startDate || endDate || status) && (
                <FilterClearButton
                  onClick={() => {
                    setPage(1);
                    setStartDate("");
                    setEndDate("");
                    setStatus("");
                  }}
                />
              )}
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

        {/* Table */}
        {isLoading ? (
          <LoadingState icon={<Receipt className="w-4 h-4 text-primary/50" />} message="Cargando ventas..." />
        ) : (
          <>
            {/* Cards View */}
            <div
              className={cn(
                "flex-1",
                viewMode === "grid"
                  ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 stagger-children content-start"
                  : "md:hidden space-y-2.5",
              )}
            >
              {sales.length === 0 ? (
                <EmptyState
                  icon={<Receipt className="w-6 h-6 text-muted-foreground/30" />}
                  title="No hay ventas registradas"
                />
              ) : (
                sales.map((sale) => (
                  <div
                    key={sale.id}
                    onClick={() => handleViewDetails(sale)}
                    className="cursor-pointer rounded-xl border border-border/70 bg-card p-4 shadow-2xs space-y-3 transition-colors hover:border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                        #{sale.saleNumber}
                      </span>
                      {getStatusBadge(sale.status)}
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Cliente</span>
                        <span className="font-medium text-foreground truncate max-w-[180px]">
                          {sale.customer?.name || "General"}
                        </span>
                      </div>
                      <div className="flex justify-between items-start gap-2 text-muted-foreground">
                        <span className="shrink-0">Fecha</span>
                        <span className="font-mono text-right leading-tight text-[11px]">{formatDateTime(sale.createdAt)}</span>
                      </div>
                      {isAdmin && sale.user?.name && (
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>Vendedor</span>
                          <span className="text-foreground">{sale.user.name}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-muted-foreground pt-0.5">
                        <span>Método de pago</span>
                        <div><PaymentStateBadge payments={sale.payments} financed={sale.financed} short /></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground">Total</p>
                        <p className="font-mono text-sm font-semibold text-foreground tabular-nums">
                          {formatCurrency(sale.total)}
                        </p>
                      </div>
                      <div
                        className="flex items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleViewDetails(sale)}
                        >
                          <Eye className="w-3.5 h-3.5" /> Detalle
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handlePrintReceipt(sale.id)}
                          className="w-7 px-0"
                          title="Descargar comprobante"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop Table View */}
            {viewMode === "table" && (
            <div
              ref={listRef}
              className="hidden md:block w-full flex-1 rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden animate-fade-in"
            >
              <div className="overflow-x-auto">
                <Table variant="default" className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                        N° Venta
                      </TableCell>
                      <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                        Fecha
                      </TableCell>
                      <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                        Cliente
                      </TableCell>
                      {isAdmin && (
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Vendedor
                        </TableCell>
                      )}
                      <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                        Método
                      </TableCell>
                      <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                        Estado
                      </TableCell>
                      <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                        Total
                      </TableCell>
                      <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                        Acciones
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {sales.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="text-center py-14">
                          <EmptyState icon={<Receipt className="w-6 h-6 text-muted-foreground/30" />} title="No hay ventas registradas" />
                        </td>
                      </tr>
                    ) : (
                      sales.map((sale) => (
                        <TableRow
                          key={sale.id}
                          onClick={() => handleViewDetails(sale)}
                          className="cursor-pointer"
                        >
                          <TableCell>
                            <span className="text-xs font-semibold text-foreground font-mono tabular-nums">
                              #{sale.saleNumber}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap font-mono tabular-nums">
                            {formatDateTime(sale.createdAt)}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate">
                            {sale.customer?.name ? (
                              <span className="text-xs font-medium text-foreground">
                                {sale.customer.name}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                General
                              </span>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="max-w-[130px] truncate">
                              {sale.user?.name ? (
                                <span className="text-xs text-muted-foreground">
                                  {sale.user.name}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">
                                  N/A
                                </span>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            <PaymentStateBadge payments={sale.payments} financed={sale.financed} short />
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(sale.status)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                              {formatCurrency(sale.total)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleViewDetails(sale)}
                                className="p-1.5 h-7 w-7 rounded-md border border-transparent hover:border-border/70 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                                title="Ver detalle"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handlePrintReceipt(sale.id)}
                                className="p-1.5 h-7 w-7 rounded-md border border-transparent hover:border-border/70 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                                title="Descargar comprobante"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            </div>
            )}

            {meta && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                pageSize={pageSize}
                itemLabel="venta"
              />
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={`Detalles — Venta #${selectedSale?.saleNumber}`}
        size="lg"
      >
        {selectedSale && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                {
                  label: "Cliente",
                  value: selectedSale.customer?.name || "Cliente General",
                },
                {
                  label: "Vendedor",
                  value: selectedSale.user?.name || "N/A",
                },
                {
                  label: "Fecha",
                  value: formatDateTime(selectedSale.createdAt),
                  mono: true,
                },
                {
                  label: "Estado",
                  value: getStatusBadge(selectedSale.status),
                  isNode: true,
                },
              ].map(({ label, value, isNode, mono }) => (
                <div
                  key={label}
                  className="p-3 rounded-lg bg-muted/30 border border-border/60 min-w-0"
                >
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {label}
                  </p>
                  {isNode ? (
                    value
                  ) : (
                    <p
                      className={cn(
                        "text-xs font-semibold text-foreground truncate",
                        mono && "font-mono tabular-nums",
                      )}
                    >
                      {value as string}
                    </p>
                  )}
                </div>
              ))}
              <div className="col-span-2 sm:col-span-4 p-3 rounded-lg bg-muted/30 border border-border/60">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Método de pago
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedSale.payments?.length ? (
                    selectedSale.payments.map((p, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-foreground"
                      >
                        <span className={getPaymentState([p]).className}>
                          {{
                            CASH: "Efectivo",
                            CARD: "Tarjeta",
                            TRANSFER: "Transferencia",
                          }[p.method] || p.method}
                          :
                        </span>
                        <span className="font-mono font-semibold tabular-nums">
                          {formatCurrency(p.amount)}
                        </span>
                      </span>
                    ))
                  ) : selectedSale.financed ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-600 dark:text-violet-400">
                      Financiado · el cobro va al préstamo asociado
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin pago</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground">
                  Items de la venta
                </p>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {selectedSale.items.length}{" "}
                  {selectedSale.items.length === 1 ? "producto" : "productos"}
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/50 max-h-56 overflow-y-auto scrollbar-app">
                {selectedSale.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between px-3.5 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                        {item.product?.name || "Producto eliminado"}
                      </p>
                      <p className="text-[11px] font-mono text-muted-foreground tabular-nums mt-0.5">
                        {formatCurrency(item.unitPrice)} × {item.quantity}
                      </p>
                    </div>
                    <span className="font-mono text-xs sm:text-sm font-semibold text-foreground tabular-nums ml-4">
                      {formatCurrency(item.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3.5 border-t border-border/60 space-y-1.5">
              {[
                {
                  label: "Subtotal",
                  value: formatCurrency(selectedSale.subtotal),
                },
                {
                  label: "Impuestos",
                  value: formatCurrency(selectedSale.taxAmount),
                },
                ...(selectedSale.discountAmount > 0
                  ? [
                      {
                        label: "Descuento",
                        value: `-${formatCurrency(selectedSale.discountAmount)}`,
                        accent: true,
                      },
                    ]
                  : []),
              ].map(({ label, value, accent }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span
                    className={cn(
                      "font-mono font-medium tabular-nums",
                      accent
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-foreground",
                    )}
                  >
                    {value}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-2.5 border-t border-border/60">
                <span className="text-sm font-semibold text-foreground">Total</span>
                <span className="font-mono text-lg font-semibold text-foreground tabular-nums">
                  {formatCurrency(selectedSale.total)}
                </span>
              </div>
              {selectedSale.amountPaid != null && selectedSale.amountPaid > 0 && (
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-muted-foreground">Recibido</span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {formatCurrency(selectedSale.amountPaid)}
                  </span>
                </div>
              )}
              {selectedSale.change != null && selectedSale.change > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Cambio</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatCurrency(selectedSale.change)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={() => handlePrintReceipt(selectedSale.id)}>
                <Download className="w-4 h-4" /> Descargar Comprobante
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}

function SalesPageFallback() {
  return (
    <DashboardLayout>
      <LoadingState icon={<Receipt className="w-4 h-4 text-primary/50" />} message="Cargando ventas..." />
    </DashboardLayout>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<SalesPageFallback />}>
      <SalesPageContent />
    </Suspense>
  );
}
