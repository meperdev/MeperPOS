"use client";

import { useState } from "react";
import { Check, CheckCircle2, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  downloadPurchaseOrderPdf,
  useConfirmPurchaseOrder,
  useSendPurchaseOrder,
} from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn, getBogotaDateInputValue } from "@/lib/utils";
import type { PurchaseOrder } from "@/types";

interface ConfirmSendModalProps {
  order: PurchaseOrder;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Confirm and send in one place, in two steps: a joined `[ Confirmar | Enviar ]`
 * group. Enviar turns on when the server answers that the order is confirmed,
 * never on a timer, so the supplier can never receive an order whose
 * confirmation failed. Closing after confirming leaves the order confirmed and
 * unsent; the detail page offers Enviar again.
 */
export function ConfirmSendModal({ order, isOpen, onClose }: ConfirmSendModalProps) {
  const toast = useToast();
  const confirmOrder = useConfirmPurchaseOrder();
  const sendOrder = useSendPurchaseOrder();

  const [confirmedHere, setConfirmedHere] = useState(false);
  const [expectedDate, setExpectedDate] = useState(
    order.expectedDeliveryDate ? order.expectedDeliveryDate.slice(0, 10) : "",
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const confirmed = confirmedHere || order.status !== "DRAFT";
  // The expected delivery day belongs to the document, so it is editable until
  // the order is sent: an order confirmed without a date can still get one here.
  const dateEditable = !order.sentAt;

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await confirmOrder.mutateAsync(
        expectedDate
          ? { id: order.id, expectedDeliveryDate: expectedDate }
          : { id: order.id },
      );
      setConfirmedHere(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo confirmar la orden"));
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSend = async () => {
    setIsSending(true);
    try {
      // The send freezes the document first; the download then renders that
      // frozen document, so the file in hand is the one on record.
      await sendOrder.mutateAsync({
        id: order.id,
        ...(expectedDate ? { expectedDeliveryDate: expectedDate } : {}),
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo enviar la orden"));
      setIsSending(false);
      return;
    }

    try {
      await downloadPurchaseOrderPdf(order);
      toast.success(
        `OC-${order.orderNumber} enviada. Se descargó el PDF para el proveedor.`,
      );
      onClose();
    } catch {
      toast.error(
        "La orden quedó enviada, pero no se pudo descargar el PDF. Descárgalo desde el detalle.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Confirmar y enviar OC-${order.orderNumber}`}
      size="sm"
      className="max-w-lg"
    >
      <div className="space-y-4">
        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li className={cn(confirmed && "text-foreground")}>
            1. Confirma la orden: ya no se podrá editar.
          </li>
          <li className={cn(confirmed && "text-foreground")}>
            2. Envíala: se descarga el PDF para{" "}
            {order.supplier?.name ?? "el proveedor"}.
          </li>
        </ol>

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label="Fecha de entrega esperada (opcional)"
              type="date"
              value={expectedDate}
              min={getBogotaDateInputValue()}
              onChange={(event) => setExpectedDate(event.target.value)}
              disabled={!dateEditable}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => setExpectedDate(getBogotaDateInputValue())}
            disabled={!dateEditable}
          >
            Hoy
          </Button>
        </div>

        <div
          role="group"
          aria-label="Confirmar y enviar"
          className="flex w-full overflow-hidden rounded-lg border border-border/70"
        >
          <Button
            variant={confirmed ? "secondary" : "primary"}
            onClick={handleConfirm}
            loading={isConfirming}
            disabled={confirmed || isConfirming}
            className="h-11 flex-1 rounded-none border-0"
          >
            {confirmed ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" /> Confirmada
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Confirmar
              </>
            )}
          </Button>
          <span aria-hidden="true" className="w-px self-stretch bg-border/70" />
          <Button
            variant={confirmed ? "primary" : "secondary"}
            onClick={handleSend}
            loading={isSending}
            disabled={!confirmed || isSending}
            className={cn(
              "h-11 flex-1 rounded-none border-0 transition-colors duration-300",
              !confirmed && "opacity-60",
            )}
          >
            <Send className="h-4 w-4" aria-hidden="true" /> Enviar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
