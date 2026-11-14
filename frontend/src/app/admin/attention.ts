import type { Organization } from "@/hooks/useAdmin";
import { trialDaysLeft } from "@/app/admin/organizations/list";

export interface AttentionItem {
  id: string;
  name: string;
  reason: string;
  /** 1 = money or an expired trial, 2 = access risk, 3 = setup gap. */
  severity: 1 | 2 | 3;
}

/**
 * The SuperAdmin work queue: one reason per tenant, the most severe one first.
 * Only tenants that need a decision reach this list, so the panel stays short.
 */
export function buildAttentionItems(
  organizations: Organization[],
  now: Date = new Date(),
  limit = 5,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const organization of organizations) {
    const days = trialDaysLeft(organization.trialEndsAt, now);

    if (organization.status === "TRIAL" && days !== null && days < 0) {
      items.push({
        id: organization.id,
        name: organization.name,
        reason: "Prueba vencida",
        severity: 1,
      });
    } else if (
      organization.status === "PAST_DUE" ||
      organization.billingStatus === "OVERDUE"
    ) {
      items.push({
        id: organization.id,
        name: organization.name,
        reason: "Facturación en mora",
        severity: 1,
      });
    } else if (organization.status === "SUSPENDED") {
      items.push({
        id: organization.id,
        name: organization.name,
        reason: "Suspendida",
        severity: 2,
      });
    } else if (organization.status === "TRIAL" && days !== null && days <= 7) {
      items.push({
        id: organization.id,
        name: organization.name,
        reason:
          days === 0
            ? "Prueba vence hoy"
            : `Prueba vence en ${days} ${days === 1 ? "día" : "días"}`,
        severity: 2,
      });
    } else if ((organization.userCount ?? 0) === 0) {
      items.push({
        id: organization.id,
        name: organization.name,
        reason: "Sin usuarios",
        severity: 3,
      });
    }
  }

  return items
    .sort((a, b) => a.severity - b.severity || a.name.localeCompare(b.name, "es"))
    .slice(0, limit);
}
