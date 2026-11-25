"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { TransferStatusBadge } from "@/components/transfers/TransferStatusBadge";
import { useReceiveTransfer, useTransfer } from "@/hooks/useTransfers";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { StockTransfer } from "@/types";

interface Props {
  /** The row the list already carries; the detail read replaces it when it lands. */
  transfer: StockTransfer | null;
  isOpen: boolean;
  onClose: () => void;
  onAskCancel: (transfer: StockTransfer) => void;
  /**
   * Cancellation is administrative. The destination's cashier receives only, so
   * the screen hides the button for it; the server refuses the route anyway.
   */
  canCancel?: boolean;
}

const TYPE_LABEL = { STORE: "Sucursal", WAREHOUSE: "Bodega" } as const;

/** Units travelling, summed from the lines the server already sent. */
function totalUnits(transfer: StockTransfer): number {
  return transfer.items.reduce(
    (total, item) => total + (Number(item.quantity) || 0),
    0,
  );
}

function SiteEnd({
  site,
  label,
}: {
  site: StockTransfer["fromLocation"];
  label: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium text-foreground">{site.name}</p>
      <Badge variant={site.type === "WAREHOUSE" ? "info" : "default"}>
        {TYPE_LABEL[site.type]}
      </Badge>
    </div>
  );
}

/**
 * What happened to the document after it left the origin, as label/value rows:
 * an instant keeps its readable wording (a date is text, so proportional
 * figures), and the cancellation reason is read in full.
 */
function StatusFacts({ transfer }: { transfer: StockTransfer }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (transfer.receivedAt) {
    rows.push({ label: "Recibida", value: formatDateTime(transfer.receivedAt) });
  }
  if (transfer.receivedBy?.name) {
    rows.push({ label: "Recibida por", value: transfer.receivedBy.name });
  }
  if (transfer.cancelledAt) {
    rows.push({ label: "Cancelada", value: formatDateTime(transfer.cancelledAt) });
  }
  if (transfer.cancelledBy?.name) {
    rows.push({ label: "Cancelada por", value: transfer.cancelledBy.name });
  }
  if (transfer.cancelReason) {
    rows.push({ label: "Motivo", value: transfer.cancelReason });
  }
  if (rows.length === 0) return null;

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-card px-4 py-3 shadow-2xs sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] font-medium text-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One transfer, read-only, with the one action its status still admits:
 * receiving it at the destination while it is in transit. The actions sit in the
 * dialog footer, where every other house dialog keeps them, so the document is
 * read top to bottom and acted on at its end.
 */
export function TransferDetailModal({
  transfer,
  isOpen,
  onClose,
  onAskCancel,
  canCancel = true,
}: Props) {
  const toast = useToast();
  const receive = useReceiveTransfer();
  // A fresh read keeps the actions honest after another tab or person moved the
  // document; the list row is the fallback while it loads.
  const fresh = useTransfer(transfer?.id ?? "");
  const shown = fresh.data ?? transfer;

  const handleReceive = async () => {
    if (!shown) return;
    try {
      const updated = await receive.mutateAsync({ id: shown.id });
      toast.success("Transferencia recibida", {
        description: `TR-${updated.number}`,
      });
      onClose();
    } catch (error) {
      toast.error("No se pudo recibir la transferencia", {
        description: getApiErrorMessage(
          error,
          "Solo se pueden recibir transferencias en tránsito.",
        ),
      });
    }
  };

  const inTransit = shown?.status === "IN_TRANSIT";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={shown ? `TR-${shown.number}` : "Transferencia"}
      size="lg"
      footer={
        shown ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {inTransit && canCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onAskCancel(shown)}
              >
                Cancelar
              </Button>
            )}
            {inTransit && (
              <Button type="button" onClick={handleReceive} loading={receive.isPending}>
                Recibir
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {!shown ? (
        <LoadingState icon={<ArrowRight aria-hidden="true" />} message="Cargando transferencia…" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TransferStatusBadge status={shown.status} />
            <p className="text-[13px] text-muted-foreground">
              {formatDateTime(shown.createdAt)}
              {shown.createdBy?.name ? ` · ${shown.createdBy.name}` : ""}
            </p>
          </div>

          <div className="grid gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs sm:grid-cols-[1fr_auto_1fr] sm:items-start">
            <SiteEnd site={shown.fromLocation} label="Origen" />
            <ArrowRight
              aria-hidden="true"
              className="hidden h-4 w-4 self-center text-muted-foreground sm:block"
            />
            <SiteEnd site={shown.toLocation} label="Destino" />
          </div>

          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Productos</h3>
              <p className="text-[13px] text-muted-foreground">
                <span className="tabular-nums">
                  {shown.items.length}{" "}
                  {shown.items.length === 1 ? "ítem" : "ítems"}
                </span>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">{totalUnits(shown)} und.</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[320px]">
                <TableHeader>
                  <TableRow>
                    <TableCell as="th">Producto</TableCell>
                    <TableCell as="th" className="text-right">
                      Cantidad
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {shown.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.product?.name ?? item.productId}
                        </p>
                        <p className="truncate text-[13px] text-muted-foreground id-text">
                          {item.product?.sku}
                        </p>
                      </TableCell>
                      <TableCell numeric className="font-semibold text-foreground">
                        {item.quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          {shown.notes && (
            <div className="rounded-xl border border-border/70 bg-card px-4 py-3 shadow-2xs">
              <h3 className="text-sm font-semibold text-foreground">Observaciones</h3>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                {shown.notes}
              </p>
            </div>
          )}

          <StatusFacts transfer={shown} />
        </div>
      )}
    </Modal>
  );
}
