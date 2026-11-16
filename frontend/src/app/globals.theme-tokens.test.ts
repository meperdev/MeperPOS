import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const layoutTsx = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");

/** Declarations that actually apply (strip comments so commented-out values are ignored). */
const activeLines = globalsCss
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("/*") && !line.startsWith("*"));

describe("slice 1: canonical token palette (ADR-1/ADR-2/ADR-4)", () => {
  it("uses canonical light/dark backgrounds and primary, and drops legacy values", () => {
    expect(globalsCss).toContain("--background: #FAFAF9;");
    expect(globalsCss).toContain("--primary: #C25E36;");
    expect(globalsCss).toContain("--background: #111114;");
    expect(globalsCss).toContain("--card: #18181C;");
    expect(globalsCss).not.toContain("#C17B5A");
    expect(globalsCss).not.toContain("#1A1917");
    expect(globalsCss).not.toContain("#FAF8F5");
  });

  it("defines a functional --primary-light for light and dark, mapped to Tailwind", () => {
    expect(globalsCss).toContain("--primary-light: #FAECE5;");
    expect(globalsCss).toContain("--primary-light: #2C1D18;");
    expect(globalsCss).toContain("--color-primary-light: var(--primary-light);");
  });

  it("adds a coral token for validation/error states in both modes", () => {
    expect(globalsCss).toContain("--coral: #D0453F;");
    expect(globalsCss).toContain("--coral: #E0524C;");
    expect(globalsCss).toContain("--color-coral: var(--coral);");
  });
});

describe("polish wave 1: warm neutrals and semantic status tokens (D1/D2)", () => {
  it("uses the warm stone neutrals in light mode", () => {
    expect(globalsCss).toContain("--foreground: #1C1917;");
    expect(globalsCss).toContain("--muted: #F5F5F4;");
    expect(globalsCss).toContain("--muted-foreground: #625D58;");
    expect(globalsCss).toContain("--border: #D6D3D1;");
    expect(globalsCss).toContain("--border-subtle: #E7E5E4;");
  });

  it("keeps dark --border-subtle subtler than --border", () => {
    expect(globalsCss).toContain("--border: #30303A;");
    expect(globalsCss).toContain("--border-subtle: #26262C;");
  });

  it("defines text and info tokens for light and dark, mapped to Tailwind", () => {
    expect(globalsCss).toContain("--success-text: #15803D;");
    expect(globalsCss).toContain("--success-text: #4ADE80;");
    expect(globalsCss).toContain("--warning-text: #B45309;");
    expect(globalsCss).toContain("--warning-text: #FBBF24;");
    expect(globalsCss).toContain("--danger-text: #B91C1C;");
    expect(globalsCss).toContain("--danger-text: #F87171;");
    expect(globalsCss).toContain("--info: #2563EB;");
    expect(globalsCss).toContain("--info: #60A5FA;");
    expect(globalsCss).toContain("--info-text: #1D4ED8;");
    expect(globalsCss).toContain("--color-success-text: var(--success-text);");
    expect(globalsCss).toContain("--color-warning-text: var(--warning-text);");
    expect(globalsCss).toContain("--color-danger-text: var(--danger-text);");
    expect(globalsCss).toContain("--color-info: var(--info);");
    expect(globalsCss).toContain("--color-info-text: var(--info-text);");
  });
});

describe("slice 1: green accent kept as documented commented secondary (ADR-3/D1)", () => {
  it("annotates the green accent with the exact note and does not emit it via an active selector", () => {
    expect(globalsCss).toContain("es una segunda opción de reemplazo al terracota");
    expect(globalsCss).toContain("--accent: #7BA08B;");
    expect(globalsCss).toContain("--accent: #8BB59D;");
    expect(activeLines).not.toContain("--accent: #7BA08B;");
    expect(activeLines).toContain("--accent: #C25E36;");
  });
});

describe("slice 1: layout font swap Manrope -> Geist (ADR-1)", () => {
  it("applies the self-hosted Geist variable and leaves Manrope behind", () => {
    expect(layoutTsx).toContain("geist-latin.woff2");
    expect(layoutTsx).toContain("--font-geist");
    expect(layoutTsx).toContain("geist.variable");
    expect(layoutTsx).not.toContain("Manrope");
  });
});

describe("mobile shell geometry tokens (S1.3)", () => {
  it("defines the tab bar height next to the mobile header", () => {
    expect(globalsCss).toContain("--mobile-tabbar:");
    expect(globalsCss).toContain("--mobile-header:");
    expect(globalsCss).toContain("--mobile-header-gap:");
  });

  it("derives the mobile content box from the fixed bars instead of a magic number", () => {
    const derived = globalsCss.match(/--mobile-content-height:\s*calc\(([^;]+)\);/);
    expect(derived).not.toBeNull();

    // Every bar the content box subtracts is a token: change a bar and the
    // pages that size themselves to the box follow it.
    for (const token of [
      "--mobile-header",
      "--mobile-header-gap",
      "--mobile-tabbar",
      "--safe-top",
      "--safe-bottom",
      "--mobile-content-bottom-gap",
    ]) {
      expect(derived![1]).toContain(token);
    }
  });
});

describe("categorical chart scale (S14): --chart-1..8 for category series", () => {
  const light = [
    "--chart-1: var(--primary);",
    "--chart-2: #2F6B8A;",
    "--chart-3: #4D7C4A;",
    "--chart-4: #B7811B;",
    "--chart-5: #6B5B95;",
    "--chart-6: #2E8C86;",
    "--chart-7: #A8456B;",
    "--chart-8: #78716C;",
  ];
  const dark = [
    "--chart-1: var(--primary);",
    "--chart-2: #5B9CC0;",
    "--chart-3: #7FB07A;",
    "--chart-4: #E0AE4A;",
    "--chart-5: #9C8BC7;",
    "--chart-6: #4FB8B0;",
    "--chart-7: #D27499;",
    "--chart-8: #A8A29E;",
  ];

  it("defines all eight chart tokens in the light :root block", () => {
    const root = globalsCss.slice(globalsCss.indexOf(":root {"), globalsCss.indexOf(".dark {"));
    for (const decl of light) expect(root).toContain(decl);
  });

  it("redefines all eight chart tokens for dark mode", () => {
    const darkBlock = globalsCss.slice(globalsCss.indexOf(".dark {"), globalsCss.indexOf("@theme inline"));
    for (const decl of dark) expect(darkBlock).toContain(decl);
  });

  it("maps each chart token into Tailwind as --color-chart-N", () => {
    for (let n = 1; n <= 8; n++) {
      expect(globalsCss).toContain(`--color-chart-${n}: var(--chart-${n});`);
    }
  });
});
