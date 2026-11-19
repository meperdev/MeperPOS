import { describe, expect, it, vi } from "vitest";
import { getPOSCapacity, observePOSGrid, POS_GRID_ROW_CLASSES, POS_MOBILE_PAGE_SIZE } from "./pos-layout";

describe("POS grid measurement lifecycle", () => {
  it("updates only when capacity changes and disconnects the observer", () => {
    let resize = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const area = document.createElement("div");
    const grid = document.createElement("div");
    let height = 552;
    Object.defineProperty(area, "clientHeight", { get: () => height });
    let width = 600;
    Object.defineProperty(grid, "clientWidth", { get: () => width });
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => (element === area
      ? { paddingTop: "16px", paddingBottom: "16px" }
      : { gridTemplateColumns: "192px 192px 192px", gridAutoRows: "248px", columnGap: "12px", rowGap: "12px" }) as unknown as CSSStyleDeclaration);
    const update = vi.fn();
    const stop = observePOSGrid(area, grid, update);
    expect(update).toHaveBeenLastCalledWith(6);
    resize();
    expect(update).toHaveBeenCalledTimes(1);
    height = 300;
    resize();
    expect(update).toHaveBeenLastCalledWith(3);
    expect(observe).toHaveBeenCalledWith(area);
    width = 4000;
    resize();
    expect(update).toHaveBeenLastCalledWith(4);
    width = 160;
    window.dispatchEvent(new Event("resize"));
    expect(update).toHaveBeenLastCalledWith(1);
    stop();
    const calls = update.mock.calls.length;
    resize();
    window.dispatchEvent(new Event("resize"));
    expect(update).toHaveBeenCalledTimes(calls);
    expect(disconnect).toHaveBeenCalledOnce();
    style.mockRestore();
    vi.unstubAllGlobals();
  });

  it("uses a removable window resize fallback without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const update = vi.fn();
    const stop = observePOSGrid(document.createElement("div"), document.createElement("div"), update);
    expect(update).toHaveBeenCalledWith(1);
    stop();
    window.dispatchEvent(new Event("resize"));
    expect(update).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("POS capacity from measured grid geometry", () => {
  it.each([
    [160, 1], [363.8, 1], [363.95, 2], [364, 2], [600, 3], [928, 4], [4000, 4],
  ])("caps columns at four and adapts at width %s", (width, columns) => {
    expect(getPOSCapacity({ width, height: 508, cardWidth: 176, cardHeight: 248, columnGap: 12, rowGap: 12 })).toBe(columns * 2);
  });

  it("fits only complete cards and gaps, not a fixed twenty", () => {
    expect(getPOSCapacity({ width: 600, height: 520, cardWidth: 192, cardHeight: 248, columnGap: 12, rowGap: 12 })).toBe(6);
    expect(getPOSCapacity({ width: 600, height: 507, cardWidth: 192, cardHeight: 248, columnGap: 12, rowGap: 12 })).toBe(3);
  });
  it("keeps one readable card on narrow/short panels and during zero-size fallback", () => {
    expect(getPOSCapacity({ width: 160, height: 248, cardWidth: 160, cardHeight: 248, columnGap: 12, rowGap: 12 })).toBe(1);
    expect(getPOSCapacity({ width: 0, height: 0, cardWidth: 0, cardHeight: 0, columnGap: 12, rowGap: 12 })).toBe(1);
  });
  it("uses actual card dimensions when width changes and stays stable for subpixel noise", () => {
    const geometry = { width: 380, height: 510, cardWidth: 184, cardHeight: 248, columnGap: 12, rowGap: 12 };
    expect(getPOSCapacity(geometry)).toBe(4);
    expect(getPOSCapacity({ ...geometry, width: 380.1 })).toBe(4);
    expect(getPOSCapacity({ ...geometry, cardHeight: 300 })).toBe(2);
  });
});

describe("POS grid below lg", () => {
  it("uses a fixed generous page size and skips capacity measurement under 1024px", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);
    vi.stubGlobal("ResizeObserver", undefined);
    const update = vi.fn();
    const stop = observePOSGrid(document.createElement("div"), document.createElement("div"), update);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(POS_MOBILE_PAGE_SIZE).toBe(12);
    expect(update).toHaveBeenCalledWith(POS_MOBILE_PAGE_SIZE);
    stop();
    vi.unstubAllGlobals();
  });

  it("keeps measured capacity at lg and up", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("ResizeObserver", undefined);
    const area = document.createElement("div");
    const grid = document.createElement("div");
    Object.defineProperty(area, "clientHeight", { get: () => 520 });
    Object.defineProperty(grid, "clientWidth", { get: () => 600 });
    const update = vi.fn();
    const stop = observePOSGrid(area, grid, update);
    // 3 columns from a 152px minimum track in 600px, 2 rows from 520px at 224px rows.
    expect(update).toHaveBeenLastCalledWith(6);
    stop();
    vi.unstubAllGlobals();
  });

  it("stretches POS rows only at lg and up", () => {
    const base = POS_GRID_ROW_CLASSES.split(" ").filter((token) => !token.startsWith("lg:"));
    expect(base).not.toEqual(expect.arrayContaining([expect.stringMatching(/grid-rows-|auto-rows-\[|h-full|aspect-auto/)]));
    expect(POS_GRID_ROW_CLASSES).toContain("lg:auto-rows-[224px]");
    expect(POS_GRID_ROW_CLASSES).toContain("lg:grid-rows-[repeat(auto-fill,minmax(224px,1fr))]");
    expect(POS_GRID_ROW_CLASSES).toContain("lg:h-full");
    expect(POS_GRID_ROW_CLASSES).toContain("lg:[&>div]:aspect-auto");
  });
});
