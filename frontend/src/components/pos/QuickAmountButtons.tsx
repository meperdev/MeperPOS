"use client";

import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";

interface QuickAmountButtonsProps {
  total: number;
  onAmountSelect: (amount: number) => void;
  disabled?: boolean;
}

export function QuickAmountButtons({ total, onAmountSelect, disabled = false }: QuickAmountButtonsProps) {
  const billAmounts = [10000, 20000, 50000, 100000];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground mb-2">Billetes</p>
        <div className="grid grid-cols-4 gap-2">
          {billAmounts.map((amount) => (
            <Button
              key={amount}
              variant="secondary"
              size="md"
              onClick={() => onAmountSelect(amount)}
              disabled={disabled}
              className="text-sm tabular-nums"
            >
              {formatCurrency(amount)}
            </Button>
          ))}
        </div>
      </div>



      <div className="pt-2 border-t border-border">
        <Button
          variant="secondary"
          onClick={() => onAmountSelect(total)}
          disabled={disabled}
          className="w-full text-sm"
        >
          Exacto ({formatCurrency(total)})
        </Button>
      </div>
    </div>
  );
}
