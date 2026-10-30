"use client";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { AlertCircle, Info } from "lucide-react";

interface PlanLimitBannerProps {
  className?: string;
}

/**
 * Blocking subscription states only. Trials, expiring subscriptions and
 * near-limit usage now live in the alert bell; repeating them here would shout
 * the same thing twice on every page.
 */
export function PlanLimitBanner({ className }: PlanLimitBannerProps) {
  const { organization } = useAuth();

  if (!organization) return null;

  const { status } = organization;
  const isPastDue = status === "PAST_DUE";
  const isSuspended = status === "SUSPENDED";
  if (!isPastDue && !isSuspended) return null;

  return (
    <div className={cn("mb-4 animate-fade-in", className)}>
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm",
          isSuspended
            ? "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200"
            : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        )}
      >
        {isSuspended ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <p>
          {isSuspended ? (
            <>
              Tu organización está <strong>suspendida</strong>. Solo puedes
              consultar datos. Contacta al administrador para reactivarla.
            </>
          ) : (
            <>
              Tu suscripción está <strong>vencida</strong>. Realiza el pago lo
              antes posible para evitar la suspensión.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
