"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { cn } from "@/lib/utils";
import { useBelowSmViewport } from "@/hooks/useVisualViewport";

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
  // Below `sm` the two actions stack as an action sheet, the way iOS orders them.
  const actionSheet = useBelowSmViewport();

  const handleConfirm = async () => {
    // Every use of this dialog removes something, so the confirm is the one
    // destructive action the phone can feel (S4.2).
    haptic("warning");
    try {
      setIsConfirming(true);
      await onConfirm();
      onClose();
    } finally {
      setIsConfirming(false);
    }
  };

  const confirmAction = (
    <Button
      key="confirm"
      variant="danger"
      onClick={handleConfirm}
      loading={isConfirming}
      className={actionSheet ? "h-11 w-full" : "flex-1"}
      size="md"
    >
      {confirmText}
    </Button>
  );

  const cancelAction = (
    <Button
      key="cancel"
      variant="secondary"
      onClick={onClose}
      disabled={isConfirming}
      // Opening a confirmation must not arm the destructive action: focus lands
      // here, so Enter or a screen-reader double-tap cannot delete by reflex.
      data-modal-autofocus
      className={actionSheet ? "h-11 w-full" : "flex-1"}
      size="md"
    >
      {cancelText}
    </Button>
  );

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

        <div className={cn("gap-2 pt-1", actionSheet ? "flex flex-col" : "flex")}>
          {/* The sheet leads with the decision, the way a native action sheet does;
              the desktop dialog keeps cancel on the left. */}
          {actionSheet ? [confirmAction, cancelAction] : [cancelAction, confirmAction]}
        </div>
      </div>
    </Modal>
  );
}
