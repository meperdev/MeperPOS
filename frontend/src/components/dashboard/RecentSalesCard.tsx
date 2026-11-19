"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { useSales } from "@/hooks/useSales";
import { getPaymentState } from "@/components/sales/PaymentState";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/** The card is a compact peek at the last sales; it never asks for more. */
const RECENT_SALES_LIMIT = 5;

/**
 * Compact "Ventas recientes" peek: the last few sales in a minimum-column
 * table. The list is capped and never scrolls internally, so the dashboard
 * height does not depend on how many sales exist.
 */
export function RecentSalesCard() {
  const { data, isLoading, isError, refetch } = useSales({ limit: RECENT_SALES_LIMIT });
  const sales = (data?.data ?? []).slice(0, RECENT_SALES_LIMIT);

  return (
    <section
      data-testid="recent-sales-card"
      className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card text-foreground transition-colors hover:border-border"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <p className="text-sm font-semibold tracking-tight text-foreground">
          Ventas recientes
        </p>
        <Link
          href="/sales"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-3 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          Ver todas
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2 px-4 pb-4 sm:px-5 sm:pb-5" aria-busy="true" data-testid="recent-sales-skeleton">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-8 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          className="mx-4 mb-4 min-h-0 py-4 shadow-none sm:mx-5 sm:mb-5"
          message="No pudimos cargar las ventas recientes."
          retryLabel="Reintentar"
          onRetry={() => refetch()}
        />
      ) : sales.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground sm:px-5 sm:pb-5">
          Sin ventas recientes
        </p>
      ) : (
        <div className="@container">
          {/* Edge to edge, like the sales page table: the header band meets the
              card borders instead of floating inside the card padding. */}
          <div className="hidden @2xl:block overflow-x-auto border-t border-border/60">
          <Table variant="default" className="min-w-[440px]">
            <TableHeader>
              <TableRow>
                <TableCell as="th">
                  #
                </TableCell>
                <TableCell as="th">
                  Hora
                </TableCell>
                <TableCell as="th">
                  Cliente
                </TableCell>
                <TableCell as="th">
                  Pago
                </TableCell>
                <TableCell as="th" className="text-right">
                  Total
                </TableCell>
                <TableCell as="th" className="text-right">
                  Estado
                </TableCell>
              </TableRow>
            </TableHeader>
            <tbody>
              {sales.map((sale) => (
                <TableRow key={sale.id} data-testid="recent-sale-row">
                  <TableCell className="font-mono font-semibold tabular-nums">
                    {sale.saleNumber}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDateTime(sale.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate">
                    {sale.customer?.name ?? "Sin cliente"}
                  </TableCell>
                  <TableCell>
                    <span className={getPaymentState(sale.payments, sale.financed).className}>{getPaymentState(sale.payments, sale.financed).label}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatCurrency(sale.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge domain="sale" status={sale.status} dot={false} />
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
          </div>

          <div data-testid="recent-sales-list" className="@2xl:hidden divide-y divide-border/60 border-t border-border/60 px-4 sm:px-5">
            {sales.map((sale) => {
              const payment = getPaymentState(sale.payments, sale.financed);
              return (
                <div key={sale.id} data-testid="recent-sale-item" className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold tabular-nums text-foreground">
                        {sale.saleNumber}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {sale.customer?.name ?? "Sin cliente"}
                      </p>
                    </div>
                    <StatusBadge domain="sale" status={sale.status} dot={false} />
                  </div>
                  <dl className="grid grid-cols-3 gap-x-3 text-xs">
                    <div className="min-w-0 space-y-0.5">
                      <dt className="text-muted-foreground">Hora</dt>
                      <dd className="text-muted-foreground tabular-nums">{formatDateTime(sale.createdAt)}</dd>
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <dt className="text-muted-foreground">Pago</dt>
                      <dd>
                        <span className={payment.className}>{payment.label}</span>
                      </dd>
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <dt className="text-muted-foreground">Total</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {formatCurrency(sale.total)}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
