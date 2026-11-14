"use client";

import { CreditCard, DollarSign, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaymentMethodCardProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}

export function PaymentMethodCard({
  label,
  icon,
  selected,
  onClick,
}: PaymentMethodCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors duration-150 ease-out",
        selected
          ? "border-emerald-600/50 dark:border-emerald-500/50 bg-emerald-500/[0.08] dark:bg-emerald-500/[0.10] text-foreground font-semibold"
          : "border-border/80 bg-muted/20 dark:bg-background/50 text-muted-foreground hover:border-foreground/25 hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "shrink-0 transition-colors duration-150",
          selected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] tracking-tight truncate">
        {label}
      </span>
      {selected && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400 ml-0.5"
        />
      )}
    </button>
  );
}

interface PaymentMethodCardsProps {
  selectedMethod: "CASH" | "CARD" | "TRANSFER";
  onMethodChange: (method: "CASH" | "CARD" | "TRANSFER") => void;
}

export function PaymentMethodCards({ selectedMethod, onMethodChange }: PaymentMethodCardsProps) {
  const methods = [
    {
      type: "CASH" as const,
      label: "Efectivo",
      icon: <DollarSign className="w-4 h-4" />,
    },
    {
      type: "CARD" as const,
      label: "Tarjeta",
      icon: <CreditCard className="w-4 h-4" />,
    },
    {
      type: "TRANSFER" as const,
      label: "Transferencia",
      icon: <Smartphone className="w-4 h-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {methods.map((method) => (
        <PaymentMethodCard
          key={method.type}
          label={method.label}
          icon={method.icon}
          selected={selectedMethod === method.type}
          onClick={() => onMethodChange(method.type)}
        />
      ))}
    </div>
  );
}
