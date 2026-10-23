"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSales } from "@/hooks/useSales";
import { printReceipt } from "@/hooks/useReceipt";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import {
  Eye,
  FileText,
  DollarSign,
  X,
  Download,
  CreditCard,
  Smartphone,
  Receipt,
} from "lucide-react";
import {
  formatCurrency,
  formatDateTime,
  getBogotaDateInputValue,
  shiftDateInputValue,
} from "@/lib/utils";
import { chipStyles } from "@/lib/chipStyles";
import type { Sale } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";

function SalesPageContent() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const isAdmin = hasAnyRole(currentUser?.role, ["ADMIN"]);
  const [search, setSearch] = useState("");
  const [status] = useState("");
  const [page, setPage] = useState(1);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const customerId = searchParams.get("customerId") ?? "";
  const customerLabel = searchParams.get("customerName") ?? "";

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

  const { data, isLoading } = useSales({
    page,
    limit: 10,
    status: status || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    search: search.trim() || undefined,
    customerId: customerId || undefined,
  });
  const sales = data?.data ?? [];
  const meta = data?.meta;

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

  const getPaymentBadge = (
    payments?: Array<{ method: string; amount: number }>,
  ) => {
    if (!payments || payments.length === 0)
      return <Badge variant="secondary">Sin pago</Badge>;
    if (payments.length > 1)
      return (
        <Badge variant="default">
          <FileText className="w-3 h-3 mr-1" />
          Mixto
        </Badge>
      );
    const m = payments[0].method;
    const icon =
      {
        CASH: <DollarSign className="w-3 h-3 mr-1" />,
        CARD: <CreditCard className="w-3 h-3 mr-1" />,
        TRANSFER: <Smartphone className="w-3 h-3 mr-1" />,
      }[m] || null;
    const label =
      { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" }[m] || m;
    return (
      <Badge variant="default">
        {icon}
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">
          {m === "CASH" ? "Efec" : m === "CARD" ? "Tarj" : "Trans"}
        </span>
      </Badge>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 lg:space-y-7">
        {/* Page Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-1 h-7 rounded-full bg-primary shrink-0" />
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
              Ventas
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
            {isAdmin
              ? "Historial de transacciones"
              : "Mis transacciones"}
          </p>
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
              <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
                <Badge variant="secondary" className="max-w-full truncate text-xs">
                  Historial de cliente {customerLabel ? `: ${customerLabel}` : "filtrado"}
                </Badge>
                <button
                  type="button"
                  onClick={() => {
                    setPage(1);
                    router.replace("/sales");
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" /> Quitar filtro
                </button>
              </div>
            ) : undefined
          }
          filterControls={
            <>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-0.5">
                Período
              </span>
              <button
                onClick={setToday}
                className="h-7 px-3 rounded-lg text-xs font-semibold bg-muted/40 border border-border/60 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                Hoy
              </button>
              <button
                onClick={setThisWeek}
                className="h-7 px-3 rounded-lg text-xs font-semibold bg-muted/40 border border-border/60 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all whitespace-nowrap"
              >
                Esta semana
              </button>
              {(startDate || endDate) && (
                <button
                  onClick={() => {
                    setPage(1);
                    setStartDate("");
                    setEndDate("");
                  }}
                  className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60 transition-colors"
                >
                  <X className="w-3 h-3" /> Limpiar
                </button>
              )}
            </>
          }
        />

        {/* Table */}
        {isLoading ? (
          <LoadingState icon={<Receipt className="w-4 h-4 text-primary/50" />} message="Cargando ventas..." />
        ) : (
          <>
            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {sales.length === 0 ? (
                <EmptyState
                  icon={<Receipt className="w-6 h-6 text-muted-foreground/30" />}
                  title="No hay ventas registradas"
                />
              ) : (
                sales.map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-2xl border border-accent/30 bg-card p-4 shadow-xs space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-primary">
                        #{sale.saleNumber}
                      </span>
                      {getStatusBadge(sale.status)}
                    </div>

                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Cliente</span>
                        <span className="font-semibold text-foreground truncate max-w-[180px]">
                          {sale.customer?.name || "General"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Fecha</span>
                        <span className="font-mono">{formatDateTime(sale.createdAt)}</span>
                      </div>
                      {isAdmin && sale.user?.name && (
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>Vendedor</span>
                          <span className="text-foreground">{sale.user.name}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-muted-foreground pt-1">
                        <span>Método de pago</span>
                        <div>{getPaymentBadge(sale.payments)}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Total</p>
                        <p className="stat-number text-base font-bold text-foreground">
                          {formatCurrency(sale.total)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleViewDetails(sale)}
                          className="h-8 px-2.5 text-xs"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> Detalle
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePrintReceipt(sale.id)}
                          className="h-8 w-8 p-0"
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
            <div className="hidden md:block rounded-3xl border border-accent/30 bg-accent/10 overflow-hidden">
              <div className="overflow-x-auto">
                <Table variant="accent" className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        N° Venta
                      </TableCell>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Fecha
                      </TableCell>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Cliente
                      </TableCell>
                      {isAdmin && (
                        <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Vendedor
                        </TableCell>
                      )}
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Método
                      </TableCell>
                      <TableCell as="th" className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </TableCell>
                      <TableCell as="th" className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Total
                      </TableCell>
                      <TableCell as="th" className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                        <TableRow key={sale.id}>
                          <TableCell>
                            <span className="text-xs font-bold text-primary font-mono">
                              #{sale.saleNumber}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap font-mono">
                            {formatDateTime(sale.createdAt)}
                          </TableCell>
                          <TableCell className="max-w-[130px] truncate">
                            {sale.customer?.name ? (
                              <span className="text-xs font-bold text-foreground">
                                {sale.customer.name}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground font-medium">
                                General
                              </span>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="max-w-[120px] truncate">
                              {sale.user?.name ? (
                                <span className="text-xs font-medium text-foreground">
                                  {sale.user.name}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  N/A
                                </span>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            {getPaymentBadge(sale.payments)}
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(sale.status)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="stat-number text-sm font-bold text-foreground">
                              {formatCurrency(sale.total)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleViewDetails(sale)}
                                className="p-1.5 h-7 w-7"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handlePrintReceipt(sale.id)}
                                className="p-1.5 h-7 w-7"
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

            {meta && meta.totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
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
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
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
                },
                {
                  label: "Estado",
                  value: getStatusBadge(selectedSale.status),
                  isNode: true,
                },
              ].map(({ label, value, isNode }) => (
                <div
                  key={label}
                  className="p-3 rounded-2xl bg-accent/10 border border-accent/20"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {label}
                  </p>
                  {isNode ? (
                    value
                  ) : (
                    <p className="text-sm font-semibold text-foreground">
                      {value as string}
                    </p>
                  )}
                </div>
              ))}
              <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Método de Pago
                </p>
                <div className="text-sm font-semibold text-foreground">
                  {selectedSale.payments?.length
                    ? selectedSale.payments.map((p, i) => (
                        <div key={i} className="text-xs">
                          {{
                            CASH: "Efectivo",
                            CARD: "Tarjeta",
                            TRANSFER: "Transferencia",
                          }[p.method] || p.method}
                          : {formatCurrency(p.amount)}
                        </div>
                      ))
                    : "Sin pago"}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Items
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-hide">
                {selectedSale.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-background/40 border border-primary/20"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.product?.name || "Producto eliminado"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(item.unitPrice)} × {item.quantity}
                      </p>
                    </div>
                    <span className="stat-number text-sm font-bold text-foreground ml-4">
                      {formatCurrency(item.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-primary/20 space-y-2">
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
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span
                    className={`font-medium ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}
                  >
                    {value}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-2 border-t border-primary/20">
                <span className="font-bold text-foreground">Total</span>
                <span className="stat-number text-xl font-bold text-primary">
                  {formatCurrency(selectedSale.total)}
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
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
