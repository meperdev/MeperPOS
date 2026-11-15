import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One label/value line of a sale card. The label keeps its width; the value takes
 * the rest of the row and wraps. Truncation is opt-in, for values that cannot wrap.
 */
export function SaleCardRow({
  label,
  children,
  truncate = false,
}: {
  label: string;
  children: ReactNode;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right text-foreground", truncate && "truncate")}>{children}</span>
    </div>
  );
}
