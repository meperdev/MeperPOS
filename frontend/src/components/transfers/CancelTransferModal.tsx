"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useCancelTransfer } from "@/hooks/useTransfers";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";

interface Props {
  transferId: string;
  transferNumber: number;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Cancelling an in-transit transfer sends its stock back to the origin, so the
 * server requires the reason the document will keep. The confirmation lives in
 * the dialog footer, where every other house dialog keeps its actions.
 */
export function CancelTransferModal({
  transferId,
  transferNumber,
  isOpen,
  onClose,
}: Props) {
  const toast = useToast();
  const cancelTransfer = useCancelTransfer();
  const [reason, setReason] = useState("");

  const valid = reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      await cancelTransfer.mutateAsync({
        id: transferId,
        reason: reason.trim(),
      });
      toast.success("Transferencia cancelada", {
        description: `TR-${transferNumber}`,
      });
      setReason("");
      onClose();
    } catch (error) {
      toast.error("No se pudo cancelar la transferencia", {
        description: getApiErrorMessage(
          error,
          "Solo se pueden cancelar transferencias en tránsito.",
        ),
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Cancelar TR-${transferNumber}`}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleSubmit}
            disabled={!valid}
            loading={cancelTransfer.isPending}
          >
            Cancelar transferencia
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          El stock vuelve a la sede de origen y la transferencia no se puede
          recibir después. Indica el motivo.
        </p>
        <Input
          textarea
          autoFocus
          rows={4}
          label="Motivo"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ej: La bodega no la recibe, se envió por error…"
        />
      </div>
    </Modal>
  );
}
