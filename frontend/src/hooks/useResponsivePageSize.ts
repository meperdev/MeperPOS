"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MIN_VISIBLE_ROWS,
  computeCollectionPageSize,
} from "@/lib/collection-grid";

/** One settle per window resize / rail collapse, not one per pointer move. */
export const PAGE_SIZE_DEBOUNCE_MS = 150;

export interface ResponsivePageSizeOptions {
  /** The track width the CSS grid uses (`minmax()`), from `lib/collection-grid`. */
  minCardWidth: number;
  /** The grid gap, from `lib/collection-grid`. */
  gap: number;
  /** Card height used until a rendered card can be measured. */
  rowHeight: number;
  minRows?: number;
  /** The page's fixed default: the floor, so phones keep their current list. */
  min: number;
  /** The endpoint's ceiling for `limit`. */
  max: number;
  /** Table view opts out and keeps the fixed page size. */
  enabled?: boolean;
  debounceMs?: number;
}

type Measurements = Pick<ResponsivePageSize, "pageSize" | "columns" | "rows">;

export interface ResponsivePageSize {
  pageSize: number;
  columns: number;
  rows: number;
  /** Attach to the card grid container: its width decides the column count. */
  containerRef: (element: HTMLElement | null) => void;
  /**
   * Attach to the pager, or to a `display: contents` wrapper around it. Its
   * height is the space the grid must leave free at the bottom of the viewport.
   */
  footerRef: (element: HTMLElement | null) => void;
}

/** The viewport the list is actually laid out in, scrollbar excluded. */
function viewportHeight(): number {
  if (typeof window === "undefined") return 0;
  const layoutHeight = document.documentElement?.clientHeight ?? 0;
  return layoutHeight > 0 ? layoutHeight : window.innerHeight;
}

function outsideHeight(el: Element): number {
  // A `display: contents` wrapper has no box of its own; its child is the pager.
  const own = el.getBoundingClientRect().height;
  if (own > 0) return own;
  const child = el.firstElementChild;
  return child ? child.getBoundingClientRect().height : 0;
}

function scrollOffset(): number {
  if (typeof window === "undefined") return 0;
  return window.scrollY || window.pageYOffset || 0;
}

/**
 * The page size a card grid should request so the viewport is filled instead of
 * ending in an empty band one row under the first cards.
 *
 * Geometry only: columns come from the container's own width (the same track
 * width the CSS grid uses), rows from the space between the grid's top edge and
 * the pinned pager. Nothing is derived from viewport breakpoints, so the answer
 * stays right next to the fixed sidebar and on any resolution.
 *
 * The hook owns its two refs because the grid usually mounts after the data
 * arrives, not with the page: a callback ref reports that mount, and the first
 * measurement happens on it. Before that, and in table view, the answer is the
 * page's current default, which is also the floor.
 */
export function useResponsivePageSize({
  minCardWidth,
  gap,
  rowHeight,
  minRows = MIN_VISIBLE_ROWS,
  min,
  max,
  enabled = true,
  debounceMs = PAGE_SIZE_DEBOUNCE_MS,
}: ResponsivePageSizeOptions): ResponsivePageSize {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Measurements>(() => ({
    pageSize: min,
    columns: 0,
    rows: Math.max(1, minRows),
  }));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useCallback((element: HTMLElement | null) => {
    setContainer(element);
  }, []);
  const footerRef = useCallback((element: HTMLElement | null) => {
    setFooter(element);
  }, []);

  // Table view answers the fixed size without touching the measurement: the
  // stored size belongs to the grid, so switching views never carries it over.
  const tableSize = useMemo(
    () => ({ pageSize: min, columns: 0, rows: Math.max(1, minRows) }),
    [min, minRows],
  );

  useEffect(() => {
    if (!enabled || !container) return;

    const measure = () => {
      const box = container.getBoundingClientRect();
      const width = container.clientWidth || box.width;
      if (!(width > 0)) return;

      const cardHeight = container.firstElementChild?.getBoundingClientRect().height;
      const footerHeight = footer ? outsideHeight(footer) : 0;
      const top = box.top + scrollOffset();
      const availableHeight = viewportHeight() - top - footerHeight - gap;

      const next = computeCollectionPageSize({
        containerWidth: width,
        availableHeight,
        minCardWidth,
        gap,
        rowHeight: cardHeight && cardHeight > 0 ? cardHeight : rowHeight,
        minRows,
        min,
        max,
      });

      setSize((previous) =>
        previous.pageSize === next.pageSize &&
        previous.columns === next.columns &&
        previous.rows === next.rows
          ? previous
          : next,
      );
    };

    const schedule = (immediate: boolean) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (immediate) {
        measure();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        measure();
      }, debounceMs);
    };

    // The first measurement is synchronous: one settled size, so the list never
    // loads a default page and then immediately reloads a bigger one.
    schedule(true);

    const onResize = () => schedule(false);
    window.addEventListener("resize", onResize);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => schedule(false));
    observer?.observe(container);
    if (footer) observer?.observe(footer);

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    container,
    footer,
    minCardWidth,
    gap,
    rowHeight,
    minRows,
    min,
    max,
    enabled,
    debounceMs,
  ]);

  return { ...(enabled ? size : tableSize), containerRef, footerRef };
}
