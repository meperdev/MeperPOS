import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ExpenseStatus } from "@/types";

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <StatusBadge domain="expense" status={status} />;
}
