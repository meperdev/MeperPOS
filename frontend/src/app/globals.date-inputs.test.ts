import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** The body of the first rule whose selector list contains `selector`. */
function ruleBody(selector: string): string {
  const start = globalsCss.indexOf(selector);
  if (start === -1) return "";
  const open = globalsCss.indexOf("{", start);
  const close = globalsCss.indexOf("}", open);
  return globalsCss.slice(open + 1, close);
}

// iOS Safari draws native date/time inputs with an intrinsic min-width and its
// own height, so in the installed PWA they overflow their grid track (Reportes
// "Desde"/"Hasta"). jsdom cannot render WebKit, so the rule itself is pinned.
describe("native date and time inputs follow the field geometry", () => {
  it("drops the native appearance and intrinsic min-width for every date-like input", () => {
    for (const type of ["date", "time", "datetime-local", "month"]) {
      expect(globalsCss).toContain(`input[type="${type}"]`);
    }
    const body = ruleBody('input[type="date"]');
    expect(body).toMatch(/-webkit-appearance:\s*none/);
    expect(body).toMatch(/appearance:\s*none/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/max-width:\s*100%/);
  });

  it("left-aligns the WebKit value box so the date reads like the other fields", () => {
    const body = ruleBody("::-webkit-date-and-time-value");
    expect(body).toMatch(/text-align:\s*left/);
    expect(body).toMatch(/margin:\s*0/);
  });
});
