/**
 * How many collection cards a viewport shows, and which page keeps the user in
 * place when that number changes.
 *
 * The card grid is intrinsic: `COLLECTION_GRID_CLASSES` / `PRODUCT_GRID_CLASSES`
 * in `components/ui/collectionGrid.ts` lay out `repeat(auto-fill, minmax(N,1fr))`
 * tracks. The constants below MIRROR that CSS — `collection-grid.test.ts` reads
 * the component file and fails if the two ever disagree — so the computed page
 * size can never count columns the grid does not draw.
 */

/** `minmax(10rem, 1fr)` — the product card track (`PRODUCT_GRID_CLASSES`). */
export const PRODUCT_CARD_MIN_WIDTH = 160;

/**
 * `minmax(12.5rem, 1fr)` from `lg` — the inventory track
 * (`INVENTORY_GRID_CLASSES`). Fewer, chubbier cards, as the inventory panel asks:
 * the page mirrors the `lg` breakpoint below into the page-size calculation, so
 * the computed column count is the one the grid actually draws.
 */
export const INVENTORY_CARD_MIN_WIDTH = 200;

/** Tailwind's `lg` — the width from which the inventory grid widens its track. */
export const INVENTORY_WIDE_TRACK_QUERY = "(min-width: 1024px)";

/** `minmax(16rem, 1fr)` — the generic collection card track (`COLLECTION_GRID_CLASSES`). */
export const COLLECTION_CARD_MIN_WIDTH = 256;

/** `gap-4` — the gutter between tracks, shared by both grids. */
export const COLLECTION_GRID_GAP = 16;

/** A grid below two rows reads as a list, not a collection. */
export const MIN_VISIBLE_ROWS = 2;

/**
 * `min-h-[13.5rem]` on the inventory product card: the row height to assume
 * before a rendered card can be measured. Any real card wins over this.
 *
 * 216px is what lets three rows fit a 1037px-tall viewport under the filters
 * and above the pager; the POS card keeps its taller poster and never uses it.
 */
export const PRODUCT_CARD_MIN_ROW_HEIGHT = 216;

/**
 * Only a starting point: a collection card is measured as soon as one renders,
 * so this value is never what decides the final row count.
 */
export const COLLECTION_CARD_FALLBACK_ROW_HEIGHT = 240;

/**
 * The inventory grid's row tracks: one equal, stretched track per requested row.
 *
 * Written as an inline `gridTemplateRows` instead of a CSS `repeat(auto-fill, …)`:
 * auto-fill picks its own track count, which can differ from the rows the page asked
 * for, and the leftover space then lands unevenly (1590x913 gave a 335px first row
 * over a 216px second). Explicit tracks are equal by construction, and the track count
 * does not depend on how many cards the page holds — a half-empty last page keeps the
 * full page's card height instead of stretching its single row to the whole grid.
 */
export function inventoryGridRows(rows: number): string {
  const count = Number.isFinite(rows) ? Math.max(1, Math.round(rows)) : 1;
  return `repeat(${count}, minmax(${PRODUCT_CARD_MIN_ROW_HEIGHT}px, 1fr))`;
}

/**
 * The highest page size a collection page may request. Every list endpoint
 * accepts at least this much; the loans endpoints cap `limit` at 100, which is
 * the tightest validator in the API.
 */
export const MAX_COLLECTION_PAGE_SIZE = 100;

/** Columns the intrinsic grid draws for a container of `width`. */
export function computeColumns(
  width: number,
  minCardWidth: number,
  gap: number,
): number {
  if (!(width > 0) || !(minCardWidth > 0)) return 0;
  const safeGap = Math.max(0, gap);
  return Math.max(1, Math.floor((width + safeGap) / (minCardWidth + safeGap)));
}

/**
 * Card rows that fit in `availableHeight`: the space between the grid's top and
 * the pinned pager, gap included. Never fewer than `minRows`.
 */
export function computeVisibleRows({
  availableHeight,
  rowHeight,
  gap,
  minRows = MIN_VISIBLE_ROWS,
}: {
  availableHeight: number;
  rowHeight: number;
  gap: number;
  minRows?: number;
}): number {
  const floor = Math.max(1, minRows);
  if (!(availableHeight > 0) || !(rowHeight > 0)) return floor;
  const safeGap = Math.max(0, gap);
  return Math.max(floor, Math.floor((availableHeight + safeGap) / (rowHeight + safeGap)));
}

/**
 * The page size a card grid should request: columns x rows, clamped to the
 * range the caller may use. `min` is the page's current fixed size, so a narrow
 * screen keeps exactly the list it had; `max` is the endpoint's ceiling.
 */
export function computeCollectionPageSize({
  containerWidth,
  availableHeight,
  minCardWidth,
  gap,
  rowHeight,
  minRows = MIN_VISIBLE_ROWS,
  min,
  max,
}: {
  containerWidth: number;
  availableHeight: number;
  minCardWidth: number;
  gap: number;
  rowHeight: number;
  minRows?: number;
  min: number;
  max: number;
}): { columns: number; rows: number; pageSize: number } {
  const columns = computeColumns(containerWidth, minCardWidth, gap);
  const rows = computeVisibleRows({ availableHeight, rowHeight, gap, minRows });
  const ceiling = Math.max(min, max);
  if (columns === 0) return { columns, rows, pageSize: clamp(min, min, ceiling) };
  return { columns, rows, pageSize: clamp(columns * rows, min, ceiling) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The page that keeps the first item of `page` on screen once the page size
 * changes: the item at index `(page - 1) * previousSize` lands on the page that
 * now contains it.
 */
export function remapPageForPageSize({
  page,
  previousSize,
  nextSize,
}: {
  page: number;
  previousSize: number;
  nextSize: number;
}): number {
  if (!(previousSize > 0) || !(nextSize > 0)) return page;
  const firstVisibleIndex = Math.max(0, page - 1) * previousSize;
  return Math.floor(firstVisibleIndex / nextSize) + 1;
}
