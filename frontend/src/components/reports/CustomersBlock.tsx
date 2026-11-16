"use client";

import { Users } from "lucide-react";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { getApiErrorMessage } from "@/lib/api";
import { customerRanking } from "@/lib/reportPresentation";
import { formatCurrency } from "@/lib/utils";
import type { CustomerStatistics } from "@/types";
import { SectionShell } from "./SectionShell";
import type { ReportQuery } from "./QuerySection";

/**
 * Five customers is a ranking worth a table. Fewer than two is a sentence, so
 * the block drops its card instead of floating an empty table on the page.
 */
export function CustomersBlock({
  query,
  className,
}: {
  query: ReportQuery<CustomerStatistics>;
  className?: string;
}) {
  const ranking = customerRanking(query.data?.topCustomers ?? []);

  if (query.isLoading) {
    return (
      <SectionShell
        title="Mejores clientes"
        icon={Users}
        className={className}
        bodyClassName="p-4"
      >
        <div aria-busy="true">
          <TableSkeleton
            rows={5}
            columns={3}
            label="Cargando clientes…"
            className="border-0 bg-transparent"
          />
        </div>
      </SectionShell>
    );
  }

  if (query.error) {
    return (
      <SectionShell
        title="Mejores clientes"
        icon={Users}
        className={className}
        bodyClassName="p-4"
      >
        <ErrorState
          message={getApiErrorMessage(query.error, "No se pudieron cargar clientes")}
          onRetry={() => query.refetch()}
          retryLabel="Reintentar"
          className="min-h-[120px]"
        />
      </SectionShell>
    );
  }

  if (ranking.mode !== "table") {
    return (
      <p className="rounded-xl bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Mejores clientes</span>
        <span className="mx-1">·</span>
        {ranking.mode === "single" ? (
          <span>
            {ranking.rows[0].customerName} compró {ranking.rows[0].totalSales}{" "}
            {ranking.rows[0].totalSales === 1 ? "vez" : "veces"} ·{" "}
            <span className="tabular-nums">
              {formatCurrency(ranking.rows[0].totalRevenue)}
            </span>
          </span>
        ) : (
          <span>Sin compras registradas con cliente en el período.</span>
        )}
      </p>
    );
  }

  return (
    <SectionShell
      title="Mejores clientes"
      icon={Users}
      className={className}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[420px]">
          <TableHeader>
            <TableRow>
              <TableCell as="th" className="px-4 py-2">Cliente</TableCell>
              <TableCell as="th" numeric className="px-4 py-2">
                Compras
              </TableCell>
              <TableCell as="th" numeric className="px-4 py-2">
                Total
              </TableCell>
            </TableRow>
          </TableHeader>
          <tbody>
            {ranking.rows.map((customer) => (
              <TableRow key={customer.customerId}>
                <TableCell className="px-4 py-2">
                  <span className="truncate text-xs font-medium text-foreground">
                    {customer.customerName}
                  </span>
                </TableCell>
                <TableCell numeric className="px-4 py-2 text-xs text-muted-foreground">
                  {customer.totalSales}
                </TableCell>
                <TableCell numeric className="px-4 py-2 text-xs font-semibold text-foreground">
                  {formatCurrency(customer.totalRevenue)}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </div>
    </SectionShell>
  );
}
