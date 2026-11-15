"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Tells the operator the browser has lost its network, and nothing more.
 *
 * There is no write queue in this branch, so the copy must not imply that a
 * sale is waiting to be sent or that anything will sync itself later: claiming
 * a guarantee the code does not provide is worse than saying nothing. The
 * wording is a test, not a comment.
 */
export function ConnectionStatus() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 animate-fade-in dark:text-amber-200"
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>Sin conexión. Los datos que ves pueden estar desactualizados.</p>
    </div>
  );
}
