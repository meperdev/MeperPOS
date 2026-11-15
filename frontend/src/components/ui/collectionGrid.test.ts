import { describe, expect, it } from "vitest";
import { COLLECTION_GRID_CLASSES } from "@/components/ui/collectionGrid";

describe("COLLECTION_GRID_CLASSES", () => {
  it("is an intrinsic grid that picks columns from available width, not viewport breakpoints", () => {
    expect(COLLECTION_GRID_CLASSES).toBe(
      "grid gap-4 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]",
    );
    expect(COLLECTION_GRID_CLASSES).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
  });
});
