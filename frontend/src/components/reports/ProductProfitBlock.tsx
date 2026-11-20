"use client";

import { TrendingUp } from "lucide-react";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import {
  formatReportMoney,
  safeDecimalNumber,
  topProductsByGrossProfit,
} from "@/lib/reportPresentation";
import { cn } from "@/lib/utils";
import type { FinancialProductMargin } from "@/types";
import { BlockNote } from "./QuerySection";
import { SectionShell } from "./SectionShell";

/**
 * The products that actually earned money, ranked by the gross profit the
 * server already computed for each one (not by revenue: a best-seller with a
 * thin margin is not the same answer).
 */
export function ProductProfitBlock({
  products,
  isLoading = false,
  className,
}: {
  products: FinancialProductMargin[];
  isLoading?: boolean;
  className?: string;
}) {
  const rows = topProductsByGrossProfit(products);

  return (
    <SectionShell
      title="Ganancia por producto"
      icon={TrendingUp}
      className={className}
      bodyClassName="p-0"
    >
      {isLoading ? (
        <div aria-busy="true" className="p-4">
          <TableSkeleton
            rows={5}
            columns={4}
            label="Cargando ganancia por producto…"
            className="border-0 bg-transparent"
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4">
          <BlockNote>Sin ganancia por producto en el período.</BlockNote>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[460px]">
            <TableHeader>
              <TableRow>
                <TableCell as="th" className="px-4 py-2">Producto</TableCell>
                <TableCell as="th" numeric className="px-4 py-2">
                  Unidades
                </TableCell>
                <TableCell as="th" numeric className="px-4 py-2">
                  Margen
                </TableCell>
                <TableCell as="th" numeric className="px-4 py-2">
                  Utilidad
                </TableCell>
              </TableRow>
            </TableHeader>
            <tbody>
              {rows.map((product) => {
                const profit = safeDecimalNumber(product.grossProfit);
                return (
                  <TableRow key={product.productId}>
                    <TableCell className="px-4 py-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {product.productName}
                      </span>
                    </TableCell>
                    <TableCell numeric className="px-4 py-2 text-sm text-muted-foreground">
                      {product.quantity}
                    </TableCell>
                    <TableCell numeric className="px-4 py-2 text-sm text-muted-foreground">
                      {product.marginPercentage === null
                        ? "—"
                        : `${product.marginPercentage.toFixed(1)}%`}
                    </TableCell>
                    <TableCell
                      numeric
                      className={cn(
                        "px-4 py-2 text-sm font-semibold",
                        profit >= 0 ? "text-success-text" : "text-danger-text",
                      )}
                    >
                      {formatReportMoney(product.grossProfit)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </SectionShell>
  );
}
