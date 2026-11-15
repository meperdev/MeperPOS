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
        "relative flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 cursor-pointer transition-colors duration-150 ease-out",
        selected
          ? "border-success/30 bg-success/10 text-foreground font-semibold"
          : "border-border/80 bg-muted/20 dark:bg-background/50 text-muted-foreground hover:border-foreground/25 hover:bg-muted/50 hover:text-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "shrink-0 transition-colors duration-150",
          selected ? "text-success-text" : "text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] tracking-tight whitespace-nowrap">
        {label}
      </span>
      {selected && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-success"
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
    <div className="grid grid-cols-2 gap-2">
      {methods.map((method, index) => (
        <PaymentMethodCard
          key={method.type}
          className={cn(methods.length % 2 === 1 && index === methods.length - 1 && "col-span-2")}
          label={method.label}
          icon={method.icon}
          selected={selectedMethod === method.type}
          onClick={() => onMethodChange(method.type)}
        />
      ))}
    </div>
  );
}
