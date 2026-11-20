"use client";

import { UserRound } from "lucide-react";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { formatCurrency } from "@/lib/utils";
import type { UserPerformanceReport } from "@/types";
import { QuerySection, type ReportQuery } from "./QuerySection";

const SELLER_ROWS = 5;

/**
 * Sales per seller. Ticket promedio and total come from the server; the page
 * only ranks and formats them.
 */
export function SellerPerformanceBlock({
  query,
  className,
}: {
  query: ReportQuery<UserPerformanceReport>;
  className?: string;
}) {
  const rows = query.data?.data ?? [];
  const visible = rows.slice(0, SELLER_ROWS);
  const remaining = rows.length - visible.length;

  return (
    <QuerySection
      query={query}
      title="Ventas por vendedor"
      icon={UserRound}
      loadingLabel="Cargando vendedores…"
      loadingRows={5}
      loadingColumns={4}
      errorMessage="No se pudieron cargar las ventas por vendedor"
      isEmpty={visible.length === 0}
      emptyText="Sin ventas por vendedor en el período."
      className={className}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[520px]">
          <TableHeader>
            <TableRow>
              <TableCell as="th" className="px-4 py-2">Vendedor</TableCell>
              <TableCell as="th" numeric className="px-4 py-2">
                Ventas
              </TableCell>
              <TableCell as="th" numeric className="px-4 py-2">
                Ticket promedio
              </TableCell>
              <TableCell as="th" numeric className="px-4 py-2">
                Total
              </TableCell>
            </TableRow>
          </TableHeader>
          <tbody>
            {visible.map((seller) => (
              <TableRow key={seller.userId}>
                <TableCell className="px-4 py-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {seller.userName}
                  </span>
                </TableCell>
                <TableCell numeric className="px-4 py-2 text-sm text-muted-foreground">
                  {seller.salesCount}
                </TableCell>
                <TableCell numeric className="px-4 py-2 text-sm text-muted-foreground">
                  {formatCurrency(seller.avgTicket)}
                </TableCell>
                <TableCell numeric className="px-4 py-2 text-sm font-semibold text-foreground">
                  {formatCurrency(seller.revenue)}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </div>
      {remaining > 0 && (
        <p className="border-t border-border/60 px-4 py-2 text-[13px] text-muted-foreground">
          {remaining} {remaining === 1 ? "vendedor más" : "vendedores más"} con ventas en el
          período.
        </p>
      )}
    </QuerySection>
  );
}
