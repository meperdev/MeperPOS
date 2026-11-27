"use client";

import { MapPin, Pencil, Phone, Store, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { LocationSite, LocationType } from "@/types";

/** The two kinds of site, named the way the business names them. */
export const SITE_TYPE_LABEL: Record<LocationType, string> = {
  STORE: "Sucursal",
  WAREHOUSE: "Bodega",
};

/** The warehouse counterpart of a shop counter. */
const SITE_TYPE_ICON: Record<LocationType, typeof Store> = {
  STORE: Store,
  WAREHOUSE: Warehouse,
};

/**
 * One site of the organization, as a card: the type's own glyph, the name with
 * the principal mark, and the two contact lines the receipt prints. The
 * principal site carries a quiet primary tint instead of a louder chip.
 */
export function SiteCard({
  site,
  onEdit,
}: {
  site: LocationSite;
  onEdit: () => void;
}) {
  const TypeIcon = SITE_TYPE_ICON[site.type];

  return (
    <Card
      className={cn(
        "flex flex-col",
        site.isDefault && "border-primary/30 bg-primary/[0.035]",
      )}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            site.isDefault
              ? "border-primary/25 bg-primary/10 text-primary-text"
              : "border-border/70 bg-muted/50 text-muted-foreground",
          )}
        >
          <TypeIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {site.name}
            </h2>
            {site.isDefault && (
              <Badge variant="primary" className="shrink-0">
                Principal
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {SITE_TYPE_LABEL[site.type]}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-border/60 px-4 py-3">
        <p className="flex items-start gap-2 text-[13px]">
          <MapPin
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
            aria-hidden="true"
          />
          {site.address ? (
            <span className="min-w-0 break-words text-foreground/90">
              <span className="sr-only">Dirección: </span>
              {site.address}
            </span>
          ) : (
            <span className="text-muted-foreground">Sin dirección</span>
          )}
        </p>
        <p className="flex items-center gap-2 text-[13px]">
          <Phone
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
            aria-hidden="true"
          />
          {site.phone ? (
            <span className="id-text min-w-0 truncate text-foreground/90">
              <span className="sr-only">Teléfono: </span>
              {site.phone}
            </span>
          ) : (
            <span className="text-muted-foreground">Sin teléfono</span>
          )}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-end border-t border-border/60 px-3 py-2.5">
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Editar sede ${site.name}`}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Editar
        </Button>
      </div>
    </Card>
  );
}
