"use client";

import { cn } from "@/lib/utils";
import { useEffectiveViewMode } from "@/hooks/useEffectiveViewMode";
import { CardSkeleton } from "./CardSkeleton";
import { COLLECTION_GRID_CLASSES } from "./collectionGrid";
import { TableSkeleton } from "./TableSkeleton";
import type { ViewMode } from "./ViewModeToggle";

export interface CollectionSkeletonProps {
  viewMode: ViewMode;
  cards?: number;
  rows?: number;
  columns?: number;
  label?: string;
  /** Card track classes; product pages pass the narrower product grid. */
  gridClassName?: string;
  cardClassName?: string;
  className?: string;
}

/**
 * The loading placeholder for a collection list, shaped like the view the page
 * is in: a card grid in cards mode (same tracks as the real cards), a table with
 * the real column count in rows mode. One component so no page can drift back to
 * "cards on screen, rows while loading".
 *
 * Pair it with `useDeferredLoading` so a fast answer never paints it at all.
 */
export function CollectionSkeleton({
  viewMode,
  cards = 6,
  rows = 6,
  columns = 6,
  label = "Cargando...",
  gridClassName = COLLECTION_GRID_CLASSES,
  cardClassName,
  className,
}: CollectionSkeletonProps) {
  if (viewMode === "grid") {
    return (
      <CardSkeleton
        count={cards}
        label={label}
        gridClassName={cn(gridClassName, className)}
        cardClassName={cardClassName}
      />
    );
  }

  return <TableSkeleton rows={rows} columns={columns} label={label} className={className} />;
}

/**
 * The same placeholder for a Suspense boundary that renders before the page's
 * own state exists (a route fallback). It reads the stored layout preference the
 * page will honour, so the very first paint already has the right shape.
 */
export function CollectionViewSkeleton({
  storageKey,
  ...props
}: Omit<CollectionSkeletonProps, "viewMode"> & { storageKey: string }) {
  const [viewMode] = useEffectiveViewMode(storageKey);
  return <CollectionSkeleton viewMode={viewMode} {...props} />;
}
