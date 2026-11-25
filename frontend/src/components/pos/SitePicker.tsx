"use client";

import { useId } from "react";
import { CheckCircle2, MapPin, Phone, Store, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { PosSite } from "@/hooks/usePosSiteContext";
import { cn } from "@/lib/utils";

export interface SitePickerProps {
  sites: PosSite[];
  /** The store the till is on right now: marked, so the cashier can keep it. */
  currentId?: string;
  onPick: (siteId: string) => void;
  className?: string;
}

/**
 * The stores a cashier may charge at, one tile per store.
 *
 * Picking a tile opens that store, so each tile is a button rather than a radio:
 * the screen never holds a pending choice waiting to be confirmed. A tile's
 * accessible name is the store name alone; the principal badge, the address and
 * the phone ride along as its description, so the name stays short enough to
 * scan while nothing is hidden from a screen reader.
 */
export function SitePicker({
  sites,
  currentId,
  onPick,
  className,
}: SitePickerProps) {
  const baseId = useId();

  return (
    <div
      role="group"
      aria-label="Sedes"
      className={cn("grid gap-3 sm:grid-cols-2", className)}
    >
      {sites.map((site) => {
        const current = site.id === currentId;
        const Icon = site.type === "WAREHOUSE" ? Warehouse : Store;
        const nameId = `${baseId}-name-${site.id}`;
        const badgeId = `${baseId}-badge-${site.id}`;
        const addressId = `${baseId}-address-${site.id}`;
        const phoneId = `${baseId}-phone-${site.id}`;
        // Each fact is its own description target: screen readers announce them
        // separated, instead of running "Calle 10 #5-20" into the phone number.
        const describedBy = [
          site.isDefault ? badgeId : null,
          site.address ? addressId : null,
          site.phone ? phoneId : null,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={site.id}
            type="button"
            onClick={() => onPick(site.id)}
            aria-labelledby={nameId}
            aria-describedby={describedBy || undefined}
            aria-current={current ? "true" : undefined}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border p-4 text-left shadow-2xs",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              current
                ? "border-primary/50 bg-primary-light"
                : "border-border/70 bg-card hover:border-border hover:bg-muted/30 active:bg-muted/50",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150",
                current
                  ? "border-primary/25 bg-card/70 text-primary-text"
                  : "border-border/70 bg-muted/50 text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  id={nameId}
                  className={cn(
                    "min-w-0 text-sm font-semibold",
                    current ? "text-primary-text" : "text-foreground",
                  )}
                >
                  {site.name}
                </span>
                {site.isDefault && (
                  <span id={badgeId}>
                    <Badge variant="primary">Principal</Badge>
                  </span>
                )}
              </span>

              {(site.address || site.phone) && (
                <span className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted-foreground">
                  {site.address && (
                    <span className="flex items-start gap-1.5">
                      <MapPin
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span id={addressId} className="min-w-0">
                        {site.address}
                      </span>
                    </span>
                  )}
                  {site.phone && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span id={phoneId} className="id-text min-w-0">
                        {site.phone}
                      </span>
                    </span>
                  )}
                </span>
              )}
            </span>

            {current && (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-primary-text"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
