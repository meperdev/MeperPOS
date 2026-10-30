"use client";

import { useState } from "react";
import { Button } from "./Button";

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

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-xs"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-xl animate-fade-in-up">
        <div className="space-y-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {message}
            </p>
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
      </div>
    </div>
  );
}
