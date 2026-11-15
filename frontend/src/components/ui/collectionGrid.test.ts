import { describe, expect, it } from "vitest";
import { COLLECTION_GRID_CLASSES, PRODUCT_GRID_CLASSES } from "@/components/ui/collectionGrid";

describe("COLLECTION_GRID_CLASSES", () => {
  it("is an intrinsic grid that picks columns from available width, not viewport breakpoints", () => {
    expect(COLLECTION_GRID_CLASSES).toBe(
      "grid gap-4 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]",
    );
    expect(COLLECTION_GRID_CLASSES).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
  });
});

describe("PRODUCT_GRID_CLASSES", () => {
  it("uses a 10rem intrinsic track so two product cards fit a 358px phone content width", () => {
    expect(PRODUCT_GRID_CLASSES).toBe(
      "grid gap-4 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]",
    );
    // 390px viewport minus 16px gutters on each side leaves 358px. Two 160px tracks
    // plus the 16px gap need 336px, so the phone gets two columns.
    expect(2 * 160 + 16).toBeLessThanOrEqual(358);
    expect(PRODUCT_GRID_CLASSES).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
  });
});
