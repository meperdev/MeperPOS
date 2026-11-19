import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLLECTION_CARD_MIN_WIDTH,
  COLLECTION_GRID_GAP,
  MAX_COLLECTION_PAGE_SIZE,
  PRODUCT_CARD_MIN_ROW_HEIGHT,
  PRODUCT_CARD_MIN_WIDTH,
  computeCollectionPageSize,
  computeColumns,
  computeVisibleRows,
  remapPageForPageSize,
} from "@/lib/collection-grid";

describe("collection grid constants mirror the shared CSS grid", () => {
  // The single card grid lives in components/ui/collectionGrid.ts. This module
  // mirrors its track width and gap so the computed page size can never drift
  // from the grid that actually renders.
  const source = readFileSync(
    path.resolve(__dirname, "../components/ui/collectionGrid.ts"),
    "utf8",
  );

  it("keeps a 10rem product track", () => {
    expect(source).toContain("minmax(10rem,1fr)");
    expect(PRODUCT_CARD_MIN_WIDTH).toBe(160); // 10rem
  });

  it("keeps a 16rem collection track", () => {
    expect(source).toContain("minmax(16rem,1fr)");
    expect(COLLECTION_CARD_MIN_WIDTH).toBe(256); // 16rem
  });

  it("keeps the gap-4 spacing", () => {
    expect(source).toContain("gap-4");
    expect(COLLECTION_GRID_GAP).toBe(16); // gap-4
  });

  it("keeps the product card's minimum row height", () => {
    const card = readFileSync(
      path.resolve(__dirname, "../components/products/ProductCard.tsx"),
      "utf8",
    );
    expect(card).toContain("min-h-[13.5rem]");
    expect(PRODUCT_CARD_MIN_ROW_HEIGHT).toBe(216); // 13.5rem
  });
});

describe("computeColumns", () => {
  it("fits as many min-width tracks as the container holds, gap included", () => {
    // (1600 + 16) / (160 + 16) = 9.18 -> 9 columns
    expect(computeColumns(1600, 160, 16)).toBe(9);
    // (358 + 16) / (160 + 16) = 2.12 -> 2 columns on a 390px phone
    expect(computeColumns(358, 160, 16)).toBe(2);
    // (1600 + 16) / (256 + 16) = 5.94 -> 5 columns for 16rem collection cards
    expect(computeColumns(1600, 256, 16)).toBe(5);
  });

  it("always keeps at least one column and never divides by a zero track", () => {
    expect(computeColumns(120, 160, 16)).toBe(1);
    expect(computeColumns(0, 160, 16)).toBe(0);
    expect(computeColumns(1600, 0, 16)).toBe(0);
  });
});

describe("computeVisibleRows", () => {
  it("counts the card rows that fit between the grid top and the pinned pager", () => {
    // (1060 + 16) / (248 + 16) = 4.07 -> 4 rows
    expect(computeVisibleRows({ availableHeight: 1060, rowHeight: 248, gap: 16 })).toBe(4);
    expect(computeVisibleRows({ availableHeight: 530, rowHeight: 248, gap: 16 })).toBe(2);
  });

  it("respects the minimum row count so a short viewport still shows a grid", () => {
    expect(computeVisibleRows({ availableHeight: 200, rowHeight: 248, gap: 16 })).toBe(2);
    expect(computeVisibleRows({ availableHeight: 200, rowHeight: 248, gap: 16, minRows: 3 })).toBe(3);
  });

  it("falls back to the minimum rows when nothing could be measured", () => {
    expect(computeVisibleRows({ availableHeight: 0, rowHeight: 248, gap: 16 })).toBe(2);
    expect(computeVisibleRows({ availableHeight: 1060, rowHeight: 0, gap: 16 })).toBe(2);
  });
});

describe("computeCollectionPageSize", () => {
  const base = {
    containerWidth: 1600,
    availableHeight: 1060,
    minCardWidth: 160,
    gap: 16,
    rowHeight: 248,
    minRows: 2,
    min: 10,
    max: MAX_COLLECTION_PAGE_SIZE,
  };

  it("multiplies the columns by the rows that fit", () => {
    expect(computeCollectionPageSize(base)).toEqual({ columns: 9, rows: 4, pageSize: 36 });
  });

  it("clamps the page size to the backend maximum it is given", () => {
    const huge = computeCollectionPageSize({
      ...base,
      containerWidth: 4000,
      availableHeight: 4000,
    });
    expect(huge.columns * huge.rows).toBeGreaterThan(MAX_COLLECTION_PAGE_SIZE);
    expect(huge.pageSize).toBe(MAX_COLLECTION_PAGE_SIZE);
  });

  it("never drops below the default page size, so a phone keeps its current list", () => {
    // 390px phone, two columns and two rows would be 4 items; the default wins.
    expect(
      computeCollectionPageSize({
        ...base,
        containerWidth: 358,
        availableHeight: 520,
        minRows: 2,
      }),
    ).toEqual({ columns: 2, rows: 2, pageSize: 10 });
  });

  it("returns the default page size before anything is measured", () => {
    expect(
      computeCollectionPageSize({ ...base, containerWidth: 0, availableHeight: 0 }),
    ).toEqual({ columns: 0, rows: 2, pageSize: 10 });
  });

  it("honours a lower backend maximum, such as the loans endpoints' 100", () => {
    expect(computeCollectionPageSize({ ...base, max: 100 }).pageSize).toBe(36);
    expect(computeCollectionPageSize({ ...base, max: 20 }).pageSize).toBe(20);
  });
});

describe("remapPageForPageSize", () => {
  it("keeps the first visible item on screen after the page size grows", () => {
    // Page 3 of 10 starts at index 20; with 20 per page that index is page 2.
    expect(remapPageForPageSize({ page: 3, previousSize: 10, nextSize: 20 })).toBe(2);
  });

  it("keeps the first visible item on screen after the page size shrinks", () => {
    // Page 2 of 20 starts at index 20; with 10 per page that index is page 3.
    expect(remapPageForPageSize({ page: 2, previousSize: 20, nextSize: 10 })).toBe(3);
  });

  it("stays on the page when the first item is already the page start", () => {
    expect(remapPageForPageSize({ page: 1, previousSize: 10, nextSize: 36 })).toBe(1);
    expect(remapPageForPageSize({ page: 4, previousSize: 10, nextSize: 40 })).toBe(1);
    expect(remapPageForPageSize({ page: 3, previousSize: 10, nextSize: 10 })).toBe(3);
  });

  it("ignores unusable sizes instead of dividing by zero", () => {
    expect(remapPageForPageSize({ page: 2, previousSize: 0, nextSize: 20 })).toBe(2);
    expect(remapPageForPageSize({ page: 2, previousSize: 10, nextSize: 0 })).toBe(2);
  });
});
