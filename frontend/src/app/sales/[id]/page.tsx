"use client";

import axios from "axios";
import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Receipt } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/Badge";
import { getPaymentState } from "@/components/sales/PaymentState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/LoadingState";
import { useSale } from "@/hooks/useSales";
import { printReceipt } from "@/hooks/useReceipt";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/utils";


function getPaymentMethodLabel(method: string) {
  switch (method) {
    case "CASH":
      return "Efectivo";
    case "CARD":
      return "Tarjeta";
    case "TRANSFER":
      return "Transferencia";
    default:
      return method;
  }
}

export default function SaleDetailPage() {
  const router = useRouter();
  const toast = useToast();
  const params = useParams<{ id: string | string[] }>();
  const saleId = Array.isArray(params.id) ? params.id[0] : params.id;

  const { data: sale, isLoading, error } = useSale(saleId ?? "");

  const errorMessage = useMemo(() => {
    if (!error) {
      return null;
    }

    if (axios.isAxiosError(error)) {
      if (error.response?.status === 403) {
        return "No tenes permisos para ver esta venta.";
      }

      if (error.response?.status === 404) {
        return "La venta no existe o fue eliminada.";
      }
    }

    return getApiErrorMessage(error, "No se pudo cargar el detalle de la venta.");
  }, [error]);

  const handlePrintReceipt = async () => {
    if (!sale) {
      return;
    }

    try {
      await printReceipt(sale.id);
    } catch (receiptError) {
      toast.error(
        getApiErrorMessage(receiptError, "Error al generar el comprobante"),
      );
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Detalle de venta
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Resumen completo de la transacción
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => router.push("/sales") }>
            <ArrowLeft className="w-3.5 h-3.5" /> Volver
          </Button>
        </div>

        {isLoading ? (
          <LoadingState icon={<Receipt className="w-4 h-4 text-primary/50" />} message="Cargando venta..." />
        ) : errorMessage || !sale ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <p className="text-sm font-semibold text-foreground">No se pudo abrir la venta</p>
              <p className="text-xs text-muted-foreground">{errorMessage ?? "La venta solicitada no esta disponible."}</p>
              <div className="pt-1">
                <Button variant="secondary" size="sm" onClick={() => router.push("/sales") }>
                  Ir a Ventas
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden border-border/70 shadow-2xs">
              <CardContent className="space-y-5 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Venta
                    </p>
                    <p className="mt-0.5 text-xl font-semibold text-foreground font-mono tabular-nums tracking-tight">
                      #{sale.saleNumber}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge domain="sale" status={sale.status} dot={false} />
                    {sale.financed && (
                      <Badge variant="primary" dot>
                        Financiado
                      </Badge>
                    )}
                    <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                      {formatDateTime(sale.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/60">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Cliente
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {sale.customer?.name || "Cliente General"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/60">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Vendedor
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {sale.user?.name || "N/A"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/60 md:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">
                      Métodos de pago
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sale.payments?.length ? (
                        sale.payments.map((payment) => (
                          <Badge
                            key={payment.id}
                            variant="secondary"
                            className={getPaymentState([payment]).className}
                          >
                            {getPaymentMethodLabel(payment.method)}: {formatCurrency(payment.amount)}
                          </Badge>
                        ))
                      ) : sale.financed ? (
                        <span className="inline-flex flex-col gap-0.5">
                          <Badge variant="primary">Financiado</Badge>
                          <span className="text-[11px] text-muted-foreground">
                            El cobro se registra en el préstamo asociado.
                          </span>
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
                      {sale.items.length}{" "}
                      {sale.items.length === 1 ? "producto" : "productos"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/50 max-h-72 overflow-y-auto scrollbar-app">
                    {sale.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-3.5 py-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {item.product?.name || "Producto eliminado"}
                          </p>
                          <p className="text-xs font-mono text-muted-foreground tabular-nums mt-0.5">
                            {formatCurrency(item.unitPrice)} × {item.quantity}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-semibold text-foreground tabular-nums ml-4">
                          {formatCurrency(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-border/60 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {formatCurrency(sale.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Impuestos</span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {formatCurrency(sale.taxAmount)}
                    </span>
                  </div>
                  {sale.discountAmount > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Descuento</span>
                      <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                        -{formatCurrency(sale.discountAmount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2.5 border-t border-border/60">
                    <span className="text-sm font-semibold text-foreground">Total</span>
                    <span className="font-mono text-lg font-semibold text-foreground tabular-nums">
                      {formatCurrency(sale.total)}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button onClick={handlePrintReceipt}>
                    <Download className="w-4 h-4" /> Descargar comprobante
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
