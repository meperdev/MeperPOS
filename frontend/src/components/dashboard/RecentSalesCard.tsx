"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { useSales } from "@/hooks/useSales";
import { getPaymentState } from "@/components/sales/PaymentState";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Sale } from "@/types";

/** The card is a compact peek at the last sales; it never asks for more. */
const RECENT_SALES_LIMIT = 5;

function getStatusBadge(status: Sale["status"]) {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="success">Completada</Badge>;
    case "CANCELLED":
      return <Badge variant="danger">Cancelada</Badge>;
    case "RETURNED_PARTIAL":
      return <Badge variant="warning">Parcial</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
}


/**
 * Compact "Ventas recientes" peek: the last few sales in a minimum-column
 * table. The list is capped and never scrolls internally, so the dashboard
 * height does not depend on how many sales exist.
 */
export function RecentSalesCard() {
  const { data } = useSales({ limit: RECENT_SALES_LIMIT });
  const sales = (data?.data ?? []).slice(0, RECENT_SALES_LIMIT);

  return (
    <section
      data-testid="recent-sales-card"
      className="min-w-0 rounded-xl border border-border/70 bg-card p-4 text-foreground transition-colors hover:border-border sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tracking-tight text-foreground">
          Ventas recientes
        </p>
        <Link
          href="/sales"
          className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted"
        >
          Ver todas
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {sales.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Sin ventas recientes
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table variant="default" className="min-w-[440px]">
            <TableHeader>
              <TableRow>
                <TableCell as="th" className="px-2 py-2 text-left font-medium text-muted-foreground">
                  #
                </TableCell>
                <TableCell as="th" className="px-2 py-2 text-left font-medium text-muted-foreground">
                  Hora
                </TableCell>
                <TableCell as="th" className="px-2 py-2 text-left font-medium text-muted-foreground">
                  Cliente
                </TableCell>
                <TableCell as="th" className="px-2 py-2 text-left font-medium text-muted-foreground">
                  Pago
                </TableCell>
                <TableCell as="th" className="px-2 py-2 text-right font-medium text-muted-foreground">
                  Total
                </TableCell>
                <TableCell as="th" className="px-2 py-2 text-right font-medium text-muted-foreground">
                  Estado
                </TableCell>
              </TableRow>
            </TableHeader>
            <tbody>
              {sales.map((sale) => (
                <TableRow key={sale.id} data-testid="recent-sale-row">
                  <TableCell className="px-2 py-2 font-mono font-semibold tabular-nums">
                    {sale.saleNumber}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-muted-foreground tabular-nums">
                    {formatDateTime(sale.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate px-2 py-2">
                    {sale.customer?.name ?? "Cliente general"}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    <span className={getPaymentState(sale.payments, sale.financed).className}>{getPaymentState(sale.payments, sale.financed).label}</span>
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right font-mono font-semibold tabular-nums">
                    {formatCurrency(sale.total)}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right">
                    {getStatusBadge(sale.status)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
