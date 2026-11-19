const MAX_POS_COLUMNS = 4;
const POS_COLUMN_GAP = 12;
// Two cards must fit the products column beside the 18rem lg cart at a 1024px viewport with the 320px sidebar.
export const POS_MIN_CARD_WIDTH = 152;
// A phone fits three tiles across: at 390px that is ~110px each, which is why
// the card itself is a short fixed tile below sm (see ProductCard).
export const POS_MIN_CARD_WIDTH_PHONE = 104;
export const POS_PHONE_COLUMNS = 3;
export const POS_PHONE_QUERY = "(max-width: 639px)";
// Keep in sync with the auto-rows-[224px] class on the POS grid: two rows must fit a 900px-tall viewport.
export const POS_CARD_ROW_HEIGHT = 224;

// Below lg the grid scrolls inside its panel instead of fitting measured rows:
// cards keep their natural shape and the page size is a fixed, generous number.
export const POS_DESKTOP_QUERY = "(min-width: 1024px)";
export const POS_MOBILE_PAGE_SIZE = 12;
// Row stretching and the measured 224px rows only apply at lg and up.
export const POS_GRID_ROW_CLASSES = [
  "auto-rows-auto gap-3",
  "lg:h-full lg:auto-rows-[224px] lg:grid-rows-[repeat(auto-fill,minmax(224px,1fr))]",
  "lg:[&>div]:h-full lg:[&>div]:aspect-auto lg:[&>div]:min-h-0 lg:[&>div]:max-h-none",
].join(" ");

function isDesktopViewport(): boolean {
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia(POS_DESKTOP_QUERY).matches;
}

/**
 * The grid's track definition. Grow the minimum track at wide widths so
 * auto-fill cannot create a fifth column, but still allow fewer readable cards
 * on narrow panels. A phone gets a three-across tile wall; everything wider
 * keeps the measured desktop geometry (see POS_MIN_CARD_WIDTH).
 */
export function posGridTemplateColumns(phone: boolean): string {
  const minWidth = phone ? POS_MIN_CARD_WIDTH_PHONE : POS_MIN_CARD_WIDTH;
  const maxColumns = phone ? POS_PHONE_COLUMNS : MAX_POS_COLUMNS;
  return `repeat(auto-fill, minmax(min(100%, max(${minWidth}px, calc((100% - ${(maxColumns - 1) * POS_COLUMN_GAP}px) / ${maxColumns}))), 1fr))`;
}

function measureCapacity(area: HTMLElement, grid: HTMLElement): number {
  const areaStyle = window.getComputedStyle(area);
  const gridStyle = window.getComputedStyle(grid);
  return getPOSCapacity({
    width: grid.getBoundingClientRect().width || grid.clientWidth,
    height: area.clientHeight - (parseFloat(areaStyle.paddingTop) || 0) - (parseFloat(areaStyle.paddingBottom) || 0),
    cardWidth: parseFloat(gridStyle.gridTemplateColumns) || POS_MIN_CARD_WIDTH,
    cardHeight: parseFloat(gridStyle.gridAutoRows) || POS_CARD_ROW_HEIGHT,
    columnGap: parseFloat(gridStyle.columnGap) || 0,
    rowGap: parseFloat(gridStyle.rowGap) || 0,
  });
}

// Observe the available area, not the content height: fetching fewer cards must
// never change capacity. The pager is a separate, permanently reserved sibling.
export function observePOSGrid(area: HTMLElement, grid: HTMLElement, update: (capacity: number) => void) {
  let lastCapacity = 0;
  let stopped = false;
  const measure = () => {
    if (stopped) return;
    const capacity = isDesktopViewport() ? measureCapacity(area, grid) : POS_MOBILE_PAGE_SIZE;
    if (capacity !== lastCapacity) {
      lastCapacity = capacity;
      update(capacity);
    }
  };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
  observer?.observe(area);
  window.addEventListener("resize", measure);
  measure();
  return () => {
    stopped = true;
    observer?.disconnect();
    window.removeEventListener("resize", measure);
  };
}

type GridGeometry = {
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
  columnGap: number;
  rowGap: number;
};

// Round down to complete tracks. CSS grid track rounding can differ by a tiny
// fraction of a pixel, so tolerate only subpixel noise, not partial cards.
export function getPOSCapacity(geometry: GridGeometry): number {
  const { width, height, cardWidth, cardHeight, columnGap, rowGap } = geometry;
  if (![width, height, cardWidth, cardHeight, columnGap, rowGap].every(Number.isFinite) ||
      width <= 0 || height <= 0 || cardWidth <= 0 || cardHeight <= 0) return 1;
  const columns = Math.min(MAX_POS_COLUMNS, Math.max(1, Math.floor((width + columnGap + 0.1) / (cardWidth + columnGap))));
  const rows = Math.max(1, Math.floor((height + rowGap + 0.1) / (cardHeight + rowGap)));
  return columns * rows;
}
