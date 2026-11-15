import { describe, expect, it } from "vitest";
import { chipStyles, getTrendChipClass } from "@/lib/chipStyles";

const PALETTE_HUE =
  /\b(?:text|bg|border)-(?:emerald|rose|amber|red|green|slate|stone|sky|violet|fuchsia|indigo|purple|orange|zinc|gray)-\d/;

describe("chipStyles light-mode contrast", () => {
  it("returns contrast-safe semantic text tokens for KPI trend chips", () => {
    const positive = getTrendChipClass(true);
    const negative = getTrendChipClass(false);

    expect(positive).toContain("text-success-text");
    expect(negative).toContain("text-danger-text");
    expect(positive).not.toMatch(/text-[^\s]*\/\d+/);
    expect(negative).not.toMatch(/text-[^\s]*\/\d+/);
  });

  it("keeps every badge variant on an opaque token text colour, never a raw palette hue", () => {
    expect(chipStyles.neutral).toContain("text-foreground");
    expect(chipStyles.secondary).toContain("text-foreground");
    expect(chipStyles.success).toContain("text-success-text");
    expect(chipStyles.warning).toContain("text-warning-text");
    expect(chipStyles.danger).toContain("text-danger-text");
    expect(chipStyles.info).toContain("text-info-text");

    for (const classes of Object.values(chipStyles)) {
      expect(classes).not.toMatch(PALETTE_HUE);
      expect(classes).not.toMatch(/text-[^\s]*\/\d+/);
    }
  });
});
