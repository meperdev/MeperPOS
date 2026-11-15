"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useCancelPurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";

interface Props {
  orderId: string;
  orderNumber: number;
  isOpen: boolean;
  onClose: () => void;
  onCancelled?: () => void;
}

export function CancelPurchaseOrderModal({
  orderId,
  orderNumber,
  isOpen,
  onClose,
  onCancelled,
}: Props) {
  const toast = useToast();
  const cancelOrder = useCancelPurchaseOrder();
  const [reason, setReason] = useState("");

  const valid = reason.trim().length >= 5;

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      await cancelOrder.mutateAsync({ id: orderId, reason: reason.trim() });
      toast.success(`OC-${orderNumber} cancelada`);
      onCancelled?.();
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo cancelar la orden"));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Cancelar OC-${orderNumber}`}
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Esta acción no se puede deshacer. Indica el motivo de la cancelación
          (mínimo 5 caracteres).
        </p>
        <Input
          textarea
          autoFocus
          rows={4}
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej: Proveedor sin stock, pedido duplicado…"
        />
        <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-border/60">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleSubmit}
            disabled={!valid}
            loading={cancelOrder.isPending}
          >
            Cancelar orden
          </Button>
        </div>
      </div>
    </Modal>
  );
}
