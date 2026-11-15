"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsConfirming(true);
      await onConfirm();
      onClose();
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      className="max-w-sm"
      ariaLabel={title}
    >
      <div className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-danger/30 bg-danger/10 text-danger-text">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isConfirming}
            className="flex-1"
            size="md"
          >
            {cancelText}
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            loading={isConfirming}
            className="flex-1"
            size="md"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
