"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import {
  useBillingStatus,
  useBillingPayments,
  useRegisterPayment,
} from "@/hooks/useBilling";
import { Button } from "@/components/ui/Button";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import {
  CreditCard,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  Users,
  Package,
  UserCircle,
  Store,
  Calendar,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

const typeLabels: Record<string, string> = {
  users: "Usuarios",
  products: "Productos",
  customers: "Clientes",
  cashRegisters: "Cajas",
};

const typeIcons: Record<string, React.ReactNode> = {
  users: <Users className="w-4 h-4" />,
  products: <Package className="w-4 h-4" />,
  customers: <UserCircle className="w-4 h-4" />,
  cashRegisters: <Store className="w-4 h-4" />,
};

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "danger"; icon: React.ReactNode }
> = {
  TRIAL: { label: "Prueba", variant: "warning", icon: <Clock className="w-3.5 h-3.5" /> },
  ACTIVE: { label: "Activo", variant: "success", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  PAST_DUE: { label: "Vencido", variant: "danger", icon: <AlertCircle className="w-3.5 h-3.5" /> },
  SUSPENDED: { label: "Suspendido", variant: "danger", icon: <XCircle className="w-3.5 h-3.5" /> },
};

const planConfig: Record<string, { label: string; color: string }> = {
  BASIC: { label: "Básico", color: "text-foreground" },
  PRO: { label: "Profesional", color: "text-accent" },
};

export default function BillingSettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const {
    data: planLimits,
    isLoading: limitsLoading,
    isError: isLimitsError,
    refetch: refetchLimits,
  } = usePlanLimits();
  const {
    data: billingStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useBillingStatus();
  const {
    data: payments,
    isLoading: paymentsLoading,
    isError: isPaymentsError,
    refetch: refetchPayments,
  } = useBillingPayments();
  const registerPayment = useRegisterPayment();

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    method: "CASH" as "CASH" | "CARD" | "TRANSFER",
    date: new Date().toISOString().split("T")[0],
  });

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isLoading = limitsLoading || statusLoading;

  const downgradeFlags = billingStatus?.settings?.downgradeFlags as
    | {
        usersOverLimit?: boolean;
        productsOverLimit?: boolean;
        customersOverLimit?: boolean;
        cashRegistersDisabled?: string[];
      }
    | undefined;

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billingStatus?.id) return;
    try {
      await registerPayment.mutateAsync({
        organizationId: billingStatus.id,
        amount: Number(paymentForm.amount),
        method: paymentForm.method,
        date: paymentForm.date,
        status: "PAID",
      });
      toast.success("Pago registrado correctamente");
      setShowPaymentForm(false);
      setPaymentForm({ amount: "", method: "CASH", date: new Date().toISOString().split("T")[0] });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al registrar el pago"));
    }
  };

  if (isLoading) {
    return (
      <LoadingState icon={<CreditCard className="w-4 h-4 text-muted-foreground" />} message="Cargando información de suscripción..." />
    );
  }

  if (!billingStatus) {
    return (
      <ErrorState
        message="No se pudo cargar la información de facturación."
        retryLabel="Reintentar"
        onRetry={refetchStatus}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          Suscripción
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Plan, límites de uso e historial de pagos
        </p>
      </div>

      {/* Plan Card */}
      <div className="rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border/60">
          <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="text-xs sm:text-sm font-semibold text-foreground">
            Plan actual
          </h3>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Plan</p>
              <p
                className={cn(
                  "mt-0.5 text-base sm:text-lg font-semibold tracking-tight",
                  planConfig[billingStatus.plan]?.color,
                )}
              >
                {planConfig[billingStatus.plan]?.label ?? billingStatus.plan}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-muted-foreground">Estado</p>
              <Badge
                variant={statusConfig[billingStatus.status].variant}
                dot
                className="mt-1"
              >
                {statusConfig[billingStatus.status].label}
              </Badge>
            </div>
          </div>

          {billingStatus?.trialEndsAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>
                Fin de prueba:{" "}
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {formatDate(billingStatus.trialEndsAt)}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Downgrade Banner */}
      {downgradeFlags && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-amber-500/20">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <h3 className="text-xs sm:text-sm font-semibold text-amber-900 dark:text-amber-100">
              Ajuste de plan requerido
            </h3>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Tu plan cambió a <span className="font-semibold">Básico</span> y algunos recursos exceden los nuevos límites:
            </p>
            <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
              {downgradeFlags.usersOverLimit && <li>Usuarios sobre el límite</li>}
              {downgradeFlags.productsOverLimit && <li>Productos sobre el límite</li>}
              {downgradeFlags.customersOverLimit && <li>Clientes sobre el límite</li>}
              {Array.isArray(downgradeFlags.cashRegistersDisabled) &&
                downgradeFlags.cashRegistersDisabled.length > 0 && (
                  <li>
                    {downgradeFlags.cashRegistersDisabled.length} caja(s) deshabilitada(s)
                  </li>
                )}
            </ul>
          </div>
        </div>
      )}

      {/* Limits Card */}
      <div className="rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border/60">
          <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="text-xs sm:text-sm font-semibold text-foreground">
            Uso y Límites
          </h3>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          {isLimitsError && !planLimits ? (
            <ErrorState
              message="No se pudo cargar los límites del plan."
              retryLabel="Reintentar"
              onRetry={refetchLimits}
              className="min-h-0"
            />
          ) : (
            planLimits?.limits.map((limit) => {
              const pct = limit.limit > 0 ? (limit.current / limit.limit) * 100 : 0;
              const isUnlimited = limit.limit === -1;
              // The API reports `exceeded` from `current >= limit` so the guard can
              // block the next creation; presentation separates "no capacity left"
              // from "past the limit".
              const isOverLimit = !isUnlimited && limit.current > limit.limit;
              const isAtLimit = !isUnlimited && !isOverLimit && limit.current === limit.limit;
              const isWarning =
                !isUnlimited &&
                !isOverLimit &&
                !isAtLimit &&
                limit.current >= limit.warningAt;

              return (
                <div key={limit.type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <span className="text-muted-foreground [&_svg]:w-3.5 [&_svg]:h-3.5">
                        {typeIcons[limit.type]}
                      </span>
                      {typeLabels[limit.type]}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {isUnlimited ? (
                        <span className="text-muted-foreground">Ilimitado</span>
                      ) : (
                        <span
                          className={cn(
                            "text-foreground",
                            isOverLimit && "text-rose-600 dark:text-rose-400 font-semibold",
                            (isAtLimit || isWarning) && "text-amber-600 dark:text-amber-400 font-semibold"
                          )}
                        >
                          {limit.current} / {limit.limit}
                        </span>
                      )}
                    </span>
                  </div>
                  {!isUnlimited && (
                    <div className="h-2 rounded-[3px] bg-muted/60 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-[3px] transition-all duration-150",
                          isOverLimit
                            ? "bg-rose-500"
                            : isAtLimit || isWarning
                            ? "bg-amber-500"
                            : "bg-foreground/80"
                        )}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Payments History */}
      <div className="rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
            <h3 className="text-xs sm:text-sm font-semibold text-foreground">
              Historial de pagos
            </h3>
          </div>
          {isSuperAdmin && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowPaymentForm((s) => !s)}
            >
              {showPaymentForm ? "Cancelar" : "Registrar Pago"}
            </Button>
          )}
        </div>

        {showPaymentForm && isSuperAdmin && (
          <div className="p-4 border-b border-border/60 bg-muted/20">
            <form onSubmit={handleRegisterPayment} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  label="Monto (COP)"
                  type="number"
                  required
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, amount: e.target.value })
                  }
                />
                <BentoSelect
                  label="Método"
                  value={paymentForm.method}
                  onChange={(value) =>
                    setPaymentForm({
                      ...paymentForm,
                      method: value as "CASH" | "CARD" | "TRANSFER",
                    })
                  }
                  options={[
                    { value: "CASH", label: "Efectivo" },
                    { value: "CARD", label: "Tarjeta" },
                    { value: "TRANSFER", label: "Transferencia" },
                  ]}
                />
                <Input
                  label="Fecha"
                  type="date"
                  required
                  value={paymentForm.date}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, date: e.target.value })
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" loading={registerPayment.isPending} size="sm">
                  Guardar pago
                </Button>
              </div>
            </form>
          </div>
        )}

        <div className="p-4">
          {paymentsLoading ? (
            <p className="text-xs text-muted-foreground">Cargando pagos...</p>
          ) : isPaymentsError && !payments ? (
            <ErrorState
              message="No se pudo cargar el historial de pagos."
              retryLabel="Reintentar"
              onRetry={refetchPayments}
              className="min-h-0"
            />
          ) : !payments ? null : payments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No hay pagos registrados.
            </p>
          ) : (
            <div className="space-y-2">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted/60 border border-border/70 flex items-center justify-center shrink-0">
                      <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-mono text-xs font-semibold text-foreground tabular-nums">
                        {formatCurrency(Number(payment.amount))}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {formatDate(payment.date)}
                      </p>
                    </div>
                  </div>
                  <Badge
                    dot
                    variant={
                      payment.status === "PAID"
                        ? "success"
                        : payment.status === "PENDING"
                        ? "warning"
                        : "danger"
                    }
                  >
                    {payment.status === "PAID"
                      ? "Pagado"
                      : payment.status === "PENDING"
                      ? "Pendiente"
                      : "Fallido"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
