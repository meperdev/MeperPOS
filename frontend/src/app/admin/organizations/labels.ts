/**
 * One place for the organization domain labels the admin surfaces show.
 * The list and the detail must resolve the same enum to the same Spanish copy
 * and the same dot/tone, or the two screens disagree about the same tenant.
 */

export const statusOptions = [
  { value: "TRIAL", label: "En prueba" },
  { value: "ACTIVE", label: "Activa" },
  { value: "PAST_DUE", label: "Vencida" },
  { value: "SUSPENDED", label: "Suspendida" },
];

export const statusLabels: Record<string, string> = {
  TRIAL: "En prueba",
  ACTIVE: "Activa",
  PAST_DUE: "Vencida",
  SUSPENDED: "Suspendida",
};

export const statusTone: Record<string, "warning" | "success" | "danger" | "default"> = {
  TRIAL: "warning",
  ACTIVE: "success",
  PAST_DUE: "danger",
  SUSPENDED: "danger",
};

export const statusDot: Record<string, string> = {
  TRIAL: "bg-amber-500",
  ACTIVE: "bg-emerald-500",
  PAST_DUE: "bg-rose-500",
  SUSPENDED: "bg-rose-500",
};

export const planOptions = [
  { value: "BASIC", label: "Básico" },
  { value: "PRO", label: "Pro" },
];

export const planLabels: Record<string, string> = {
  BASIC: "Básico",
  PRO: "Pro",
};

export const statusLabel = (status: string) => statusLabels[status] ?? status;
