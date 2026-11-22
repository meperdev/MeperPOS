"use client";

import { CreditCard, DollarSign, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaymentMethodCardProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  className?: string;
}

export function PaymentMethodCard({
  label,
  icon,
  selected,
  onClick,
  className,
}: PaymentMethodCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-1.5 cursor-pointer transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-border/80 bg-card text-foreground font-semibold shadow-2xs"
          : "border-transparent bg-transparent text-muted-foreground font-medium hover:bg-card/50 hover:text-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "shrink-0 transition-colors duration-150",
          selected ? "text-primary-text" : "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="text-xs tracking-tight whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}

interface PaymentMethodCardsProps {
  selectedMethod: "CASH" | "CARD" | "TRANSFER";
  onMethodChange: (method: "CASH" | "CARD" | "TRANSFER") => void;
}

export function PaymentMethodCards({
  selectedMethod,
  onMethodChange,
}: PaymentMethodCardsProps) {
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
    <div
      role="group"
      aria-label="Método de pago"
      className="grid grid-cols-3 gap-1 rounded-lg border border-border/70 bg-muted/40 p-1"
    >
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
