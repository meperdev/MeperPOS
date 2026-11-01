import type { Organization } from "@/hooks/useAdmin";

export type OrganizationSort = "recent" | "oldest" | "users" | "name";

export interface OrganizationFilters {
  search: string;
  status: string;
  plan: string;
}

export const PAGE_SIZE = 10;

export const SORT_OPTIONS: { value: OrganizationSort; label: string }[] = [
  { value: "recent", label: "Más recientes" },
  { value: "oldest", label: "Más antiguas" },
  { value: "users", label: "Más usuarios" },
  { value: "name", label: "Nombre" },
];

/** Case- and accent-insensitive so "cafeteria" finds "Cafetería". */
function normalizeTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function filterOrganizations(
  organizations: Organization[],
  filters: OrganizationFilters,
): Organization[] {
  const term = normalizeTerm(filters.search);

  return organizations.filter((organization) => {
    if (filters.status !== "ALL" && organization.status !== filters.status) {
      return false;
    }
    if (filters.plan !== "ALL" && organization.plan !== filters.plan) {
      return false;
    }
    if (!term) {
      return true;
    }
    return (
      normalizeTerm(organization.name).includes(term) ||
      normalizeTerm(organization.slug).includes(term)
    );
  });
}

export function sortOrganizations(
  organizations: Organization[],
  sort: OrganizationSort,
): Organization[] {
  const copy = [...organizations];

  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "users":
      return copy.sort(
        (a, b) =>
          (b.userCount ?? 0) - (a.userCount ?? 0) ||
          a.name.localeCompare(b.name, "es"),
      );
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name, "es"));
    case "recent":
    default:
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize = PAGE_SIZE,
): { items: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: current,
    totalPages,
  };
}

export interface TrialInfo {
  label: string;
  tone: "default" | "warning" | "danger";
}

/** Days left in the trial, read from the tenant's `trialEndsAt`. */
export function trialInfo(trialEndsAt: string | null, now: Date = new Date()): TrialInfo {
  if (!trialEndsAt) {
    return { label: "—", tone: "default" };
  }

  const dayMs = 86_400_000;
  const dayStart = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((dayStart(new Date(trialEndsAt)) - dayStart(now)) / dayMs);

  if (days < 0) {
    return { label: "Vencido", tone: "danger" };
  }
  if (days === 0) {
    return { label: "Vence hoy", tone: "warning" };
  }
  if (days <= 7) {
    return { label: `${days} ${days === 1 ? "día" : "días"}`, tone: "warning" };
  }
  return { label: `${days} días`, tone: "default" };
}
