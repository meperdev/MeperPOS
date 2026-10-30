import { Badge } from "@/components/ui/Badge";
import type { ExpenseStatus } from "@/types";

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  const isPaid = status === "PAID";

  return (
    <Badge variant={isPaid ? "success" : "warning"} dot>
      {isPaid ? "Pagado" : "Parcial"}
    </Badge>
  );
}
