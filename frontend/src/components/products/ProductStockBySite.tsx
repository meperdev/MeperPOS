"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { useAuth } from "@/contexts/AuthContext";
import { hasAnyRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useProductStockBySite } from "@/hooks/useProductStock";
import { StockAdjustmentModal } from "./StockAdjustmentModal";

interface Props {
  productId: string;
  productName?: string;
  className?: string;
}

const TYPE_LABEL = { STORE: "Sucursal", WAREHOUSE: "Bodega" } as const;

/**
 * T22 — where this product's units actually are.
 *
 * The aggregate the product row carries cannot say which site holds the stock,
 * so the editor lists every site the caller may read, with that site's units,
 * its reservations and what can still leave. A site without a ledger row reads
 * as zero rather than disappearing: "no stock" is information too.
 *
 * "Ajustar existencias" is offered to the roles that may edit stock (the same
 * ones the product edit admits) and moves one site through the adjustment
 * dialog. Read-only visitors still see the numbers.
 */
export function ProductStockBySite({ productId, productName, className }: Props) {
  const { user } = useAuth();
  const canAdjust = hasAnyRole(user?.role, ["ADMIN"]);
  const { data, isLoading, isError, refetch } = useProductStockBySite(productId);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const sites = data ?? [];

  return (
    <div
      role="group"
      aria-label="Existencias por sede"
      className={cn("min-w-0 space-y-3 border-t border-border/60 pt-4", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">
          Existencias por sede
        </h3>
        {canAdjust && sites.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setIsAdjusting(true)}
          >
            Ajustar existencias
          </Button>
        )}
      </div>

      {isLoading ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          Cargando existencias…
        </p>
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-[13px] text-danger-text">
            No se pudieron cargar las existencias.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : sites.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No tienes sedes asignadas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
          <Table className="min-w-[28rem]">
            <TableHeader>
              <TableRow>
                <TableCell
                  as="th"
                  className="text-left text-xs font-medium text-muted-foreground"
                >
                  Sede
                </TableCell>
                <TableCell
                  as="th"
                  numeric
                  className="text-xs font-medium text-muted-foreground"
                >
                  Existencia
                </TableCell>
                <TableCell
                  as="th"
                  numeric
                  className="text-xs font-medium text-muted-foreground"
                >
                  Reservado
                </TableCell>
                <TableCell
                  as="th"
                  numeric
                  className="text-xs font-medium text-muted-foreground"
                >
                  Disponible
                </TableCell>
              </TableRow>
            </TableHeader>
            <tbody>
              {sites.map((site) => (
                <TableRow key={site.locationId}>
                  <TableCell className="text-sm">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">
                        {site.name}
                      </span>
                      {site.isDefault ? (
                        <Badge variant="primary">Principal</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {TYPE_LABEL[site.type]}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell numeric className="text-sm text-foreground">
                    {site.stock} uds.
                  </TableCell>
                  <TableCell
                    numeric
                    className="text-sm text-muted-foreground"
                  >
                    {site.reservedStock}
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-foreground">
                    {site.availableStock}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <StockAdjustmentModal
        isOpen={isAdjusting}
        onClose={() => setIsAdjusting(false)}
        productId={productId}
        productName={productName}
        sites={sites}
      />
    </div>
  );
}
