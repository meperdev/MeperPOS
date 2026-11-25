"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { LoadingState } from "@/components/ui/LoadingState";
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
}

const TYPE_LABEL = { STORE: "Sucursal", WAREHOUSE: "Bodega" } as const;

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
 * One transfer, read-only, with the one action its status still admits:
 * receiving it at the destination while it is in transit.
 */
export function TransferDetailModal({
  transfer,
  isOpen,
  onClose,
  onAskCancel,
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={shown ? `TR-${shown.number}` : "Transferencia"}
      size="lg"
    >
      {!shown ? (
        <LoadingState icon={<ArrowRight aria-hidden="true" />} message="Cargando transferencia…" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TransferStatusBadge status={shown.status} />
            <span className="text-[13px] text-muted-foreground">
              {formatDateTime(shown.createdAt)}
              {shown.createdBy?.name ? ` · ${shown.createdBy.name}` : ""}
            </span>
          </div>

          <div className="grid gap-3 rounded-xl border border-border/70 bg-card p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
            <SiteEnd site={shown.fromLocation} label="Origen" />
            <ArrowRight
              aria-hidden="true"
              className="hidden h-4 w-4 self-center text-muted-foreground sm:block"
            />
            <SiteEnd site={shown.toLocation} label="Destino" />
          </div>

          {shown.notes && (
            <p className="text-sm text-muted-foreground">{shown.notes}</p>
          )}

          <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/35">
                  <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    Producto
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                    Cantidad
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/40 last:border-b-0">
                    <td className="px-4 py-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.product?.name ?? item.productId}
                      </p>
                      <p className="text-[13px] text-muted-foreground id-text">
                        {item.product?.sku}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-semibold text-foreground tabular-nums">
                      {item.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {shown.status === "RECEIVED" && shown.receivedAt && (
            <p className="text-[13px] text-muted-foreground">
              Recibida el {formatDateTime(shown.receivedAt)}
              {shown.receivedBy?.name ? ` por ${shown.receivedBy.name}` : ""}.
            </p>
          )}
          {shown.status === "CANCELLED" && (
            <p className="text-[13px] text-muted-foreground">
              Cancelada
              {shown.cancelledAt ? ` el ${formatDateTime(shown.cancelledAt)}` : ""}
              {shown.cancelledBy?.name ? ` por ${shown.cancelledBy.name}` : ""}.
              {shown.cancelReason ? ` Motivo: ${shown.cancelReason}` : ""}
            </p>
          )}

          <div className="flex flex-col justify-end gap-2 border-t border-border/60 pt-4 sm:flex-row">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {shown.status === "IN_TRANSIT" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onAskCancel(shown)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleReceive}
                  loading={receive.isPending}
                >
                  Recibir
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
