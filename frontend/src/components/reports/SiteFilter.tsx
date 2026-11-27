"use client";

import { Select } from "@/components/ui/Select";
import type { LocationSite } from "@/types";

/**
 * The site the sales figures are read for.
 *
 * It appears only for a multi-site organization: with one readable site it
 * would narrow nothing, and the directory it is built from already applies the
 * access rule (owners and administrators see every site, everyone else only the
 * ones they were assigned). "Todas las sedes" is the organization-wide view.
 */
export function SiteFilter({
  sites,
  value,
  onChange,
  className,
}: {
  /** Every site the caller may read; the page already queried them. */
  sites: LocationSite[];
  value: string;
  onChange: (siteId: string) => void;
  className?: string;
}) {
  if (sites.length <= 1) {
    return null;
  }

  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder="Todas las sedes"
      className={className ?? "w-full sm:w-44 shrink-0"}
      options={[
        { value: "", label: "Todas las sedes" },
        ...sites.map((site) => ({ value: site.id, label: site.name })),
      ]}
    />
  );
}

/** The site name a report is scoped to, or null for the organization-wide view. */
export function siteScopeName(sites: LocationSite[], siteId: string) {
  return sites.find((site) => site.id === siteId)?.name ?? null;
}
