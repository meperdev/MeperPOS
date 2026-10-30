import { describe, expect, it } from "vitest";
import { settingsSections } from "./sections";

describe("settings sections registry", () => {
  it("defines the approved settings sections in the required order", () => {
    expect(settingsSections.map((section) => section.key)).toEqual([
      "general",
      "invoicing",
      "team",
      "data",
      "billing",
    ]);
  });

  it("maps every section to a /settings/ route with a label and a vector icon", () => {
    for (const section of settingsSections) {
      expect(section.href).toMatch(/^\/settings\//);
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.icon).toBeTruthy();
      expect(typeof section.icon).not.toBe("string");
    }
  });

  it("uses no emoji as structural icons or labels", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const section of settingsSections) {
      expect(emoji.test(section.label)).toBe(false);
      expect(typeof section.icon).not.toBe("string");
    }
  });
});
