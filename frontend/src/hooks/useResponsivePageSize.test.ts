import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  PAGE_SIZE_DEBOUNCE_MS,
  useResponsivePageSize,
} from "@/hooks/useResponsivePageSize";

/**
 * A measurable grid: jsdom has no layout, so every box the hook reads is stubbed
 * here. Width and height are the only two dimensions the hook is allowed to
 * trust, which keeps the test tied to the contract rather than to the DOM shape.
 */
interface Box {
  width: number;
  height: number;
  top: number;
}

function rect(box: Box) {
  return () => ({
    x: 0,
    y: box.top,
    top: box.top,
    left: 0,
    right: box.width,
    bottom: box.top + box.height,
    width: box.width,
    height: box.height,
    toJSON: () => ({}),
  });
}

function makeBox(box: Box): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: box.width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: box.height, configurable: true });
  Object.defineProperty(el, "getBoundingClientRect", { value: rect(box), configurable: true });
  return el;
}

function setViewportHeight(height: number) {
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: height,
    configurable: true,
  });
}

interface Scene {
  grid: HTMLDivElement;
  footer: HTMLDivElement;
  card: HTMLDivElement;
  pager: HTMLDivElement;
}

/**
 * Grid at `top`, one card of `cardHeight`, and a pager of `footerHeight` under
 * it — the three boxes whose geometry decides how many cards fit.
 */
function mountScene({
  width,
  top,
  cardHeight,
  footerHeight,
}: {
  width: number;
  top: number;
  cardHeight: number;
  footerHeight: number;
}): Scene {
  const grid = makeBox({ width, top, height: cardHeight });
  const card = makeBox({ width, top, height: cardHeight });
  grid.appendChild(card);
  const footer = makeBox({ width, top: top + cardHeight, height: 0 });
  const pager = makeBox({ width, top: top + cardHeight, height: footerHeight });
  footer.appendChild(pager);
  document.body.append(grid, footer);
  return { grid, footer, card, pager };
}

function resizeGrid(grid: HTMLDivElement, width: number) {
  Object.defineProperty(grid, "clientWidth", { value: width, configurable: true });
}

function optionsFor(scene: Scene | null, overrides: Record<string, unknown> = {}) {
  void scene;
  return {
    minCardWidth: 160,
    gap: 16,
    rowHeight: 248,
    minRows: 2,
    min: 10,
    max: 100,
    ...overrides,
  };
}

/**
 * The hook owns its refs: the grid usually mounts after the data arrives, so a
 * callback ref is what tells it there is something to measure.
 */
function renderPageSize(
  scene: Scene | null,
  overrides: Record<string, unknown> = {},
) {
  const hook = renderHook(() => useResponsivePageSize(optionsFor(scene, overrides)));
  if (scene) attach(hook, scene);
  return hook;
}

function attach(
  hook: ReturnType<typeof renderPageSize>,
  scene: Scene,
) {
  act(() => {
    hook.result.current.containerRef(scene.grid);
    hook.result.current.footerRef(scene.footer);
  });
}

function settle() {
  act(() => {
    vi.advanceTimersByTime(PAGE_SIZE_DEBOUNCE_MS);
  });
}

/** Resizes the container and reports it the way a real observer would. */
function resize(scene: Scene, width: number, { windowEvent = false } = {}) {
  resizeGrid(scene.grid, width);
  if (windowEvent) {
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  setViewportHeight(1440);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  Reflect.deleteProperty(document.documentElement, "clientHeight");
});

describe("useResponsivePageSize", () => {
  it("computes columns x rows that fit between the grid top and the pager", () => {
    // 1600px wide -> 9 columns. 1440 - 300 top - 64 pager - 16 gap = 1060 for cards.
    // 248 + 16 = 264 per row -> 4 rows. 9 x 4 = 36.
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene);

    settle();

    expect(result.current).toMatchObject({ pageSize: 36, columns: 9, rows: 4 });
  });

  it("clamps the computed size to the maximum the endpoint accepts", () => {
    const scene = mountScene({ width: 4000, top: 100, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene, { max: 20 });

    settle();

    expect(result.current.pageSize).toBe(20);
  });

  it("never goes below the current default, so a phone keeps its list", () => {
    setViewportHeight(844);
    // 390px phone: 358px of content, 2 columns, 2 rows -> 4 < 10 default.
    const scene = mountScene({ width: 358, top: 420, cardHeight: 248, footerHeight: 56 });
    const { result } = renderPageSize(scene);

    settle();

    expect(result.current).toMatchObject({ pageSize: 10, columns: 2, rows: 2 });
  });

  it("keeps the default page size until a container can be measured", () => {
    const scene = mountScene({ width: 0, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene);

    settle();

    expect(result.current).toMatchObject({ pageSize: 10, columns: 0, rows: 2 });
  });

  it("measures as soon as the grid mounts, even when that is after the data", () => {
    // /inventory renders its skeleton first: the grid appears with the products.
    const hook = renderPageSize(null);
    settle();
    expect(hook.result.current).toMatchObject({ pageSize: 10, columns: 0, rows: 2 });

    attach(hook, mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 }));

    expect(hook.result.current).toMatchObject({ pageSize: 36, columns: 9, rows: 4 });
  });

  it("returns the default while disabled, so table view keeps a fixed page size", () => {
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene, { enabled: false });

    settle();

    expect(result.current).toMatchObject({ pageSize: 10, columns: 0, rows: 2 });
  });

  it("debounces a burst of resizes into one settled value", () => {
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene);
    settle();
    expect(result.current.pageSize).toBe(36);

    // A window drag reports the width many times per second.
    resize(scene, 1920, { windowEvent: true });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    resize(scene, 1920, { windowEvent: true });
    act(() => {
      vi.advanceTimersByTime(60);
    });

    // 120ms in, with the last event 60ms ago: the previous size is still on screen.
    expect(result.current.pageSize).toBe(36);

    // One settle, one size: the burst collapses into a single measurement.
    settle();
    // 11 columns x 4 rows.
    expect(result.current).toMatchObject({ pageSize: 44, columns: 11, rows: 4 });
  });

  it("keeps the same size for a change that does not add or remove a column", () => {
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene);
    settle();
    const first = result.current;

    resize(scene, 1605, { windowEvent: true });
    settle();

    expect(result.current).toEqual(first);
  });

  it("follows the container, not just the window, when the rail collapses", () => {
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene);

    settle();
    expect(result.current.columns).toBe(9);

    // The sidebar collapse only changes the grid's own width: no window resize.
    resize(scene, 1216);
    act(() => {
      observers.forEach((observer) => observer.trigger());
    });
    settle();

    // (1216 + 16) / 176 = 7 columns.
    expect(result.current.columns).toBe(7);
  });

  it("measures the rendered card when the caller does not fix the row height", () => {
    // The default: a rendered card wins over `rowHeight`, because most collection
    // grids keep the card's natural height.
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 400, footerHeight: 64 });
    const { result } = renderPageSize(scene);

    settle();

    // 1060px of space for cards: (1060 + 16) / (400 + 16) = 2.58 -> 2 rows.
    expect(result.current).toMatchObject({ columns: 9, rows: 2 });
  });

  it("rebuilds the measurement when the card height changes", () => {
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 248, footerHeight: 64 });
    const { result } = renderPageSize(scene);
    settle();
    expect(result.current.rows).toBe(4);

    // A denser card measures 180px: (1060 + 16) / (180 + 16) = 5.48 -> 5 rows.
    Object.defineProperty(scene.card, "getBoundingClientRect", {
      value: rect({ width: 160, top: 300, height: 180 }),
      configurable: true,
    });
    act(() => {
      observers.forEach((observer) => observer.trigger());
    });
    settle();

    expect(result.current).toMatchObject({ pageSize: 45, columns: 9, rows: 5 });
  });
});

describe("useResponsivePageSize with a fixed row height", () => {
  it("ignores a stretched card, so the taller rows cannot shrink the page", () => {
    // Inventory stretches every row to fill the space above the pager, so the
    // rendered card is TALLER than the minimum row height. Counting rows from that
    // stretched height would ask for fewer rows, which stretches the cards further:
    // a feedback loop that never settles. The caller fixes the height instead.
    const scene = mountScene({ width: 1600, top: 300, cardHeight: 216, footerHeight: 64 });
    const { result } = renderPageSize(scene, { measureRowHeight: false });

    settle();
    // 1060px of space, 216px rows and 16px gaps: (1060 + 16) / 232 = 4 rows.
    expect(result.current).toMatchObject({ pageSize: 36, columns: 9, rows: 4 });

    // The rows stretched to fill it: the card now measures 400px.
    Object.defineProperty(scene.card, "getBoundingClientRect", {
      value: rect({ width: 200, top: 300, height: 400 }),
      configurable: true,
    });
    act(() => {
      observers.forEach((observer) => observer.trigger());
    });
    settle();

    // Same size: the count comes from the minimum row height, never the card.
    expect(result.current).toMatchObject({ pageSize: 36, columns: 9, rows: 4 });
  });
});

/**
 * jsdom has no ResizeObserver. The hook must keep working without one, so this
 * stub only proves the container subscription path is wired.
 */
const observers: Array<{ trigger: () => void }> = [];
class StubResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    const entry = { trigger: () => this.callback() };
    observers.push(entry);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  observers.length = 0;
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: StubResizeObserver,
    configurable: true,
    writable: true,
  });
});

/** A table wrapper at `top` holding a header row and one body row. */
function mountTable({
  top,
  headerHeight,
  rowHeight,
  footerHeight,
  width = 1200,
}: {
  top: number;
  headerHeight: number;
  rowHeight: number;
  footerHeight: number;
  width?: number;
}) {
  const wrapper = makeBox({ width, top, height: headerHeight + rowHeight * 20 });
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = makeBox({ width, top, height: headerHeight }) as unknown as HTMLElement;
  thead.appendChild(document.createElement("tr"));
  Object.defineProperty(thead, "getBoundingClientRect", { value: headerRow.getBoundingClientRect, configurable: true });
  const tbody = document.createElement("tbody");
  const row = document.createElement("tr");
  Object.defineProperty(row, "getBoundingClientRect", {
    value: rect({ width, top: top + headerHeight, height: rowHeight }),
    configurable: true,
  });
  tbody.appendChild(row);
  table.append(thead, tbody);
  wrapper.appendChild(table);
  const footer = makeBox({ width, top: top + 2000, height: 0 });
  const pager = makeBox({ width, top: top + 2000, height: footerHeight });
  footer.appendChild(pager);
  document.body.append(wrapper, footer);
  return { wrapper, footer, row };
}

describe("useResponsivePageSize in table view", () => {
  it("fits whole rows between the table top and the pager, ignoring how tall the table already is", () => {
    // 1000 viewport - 260 top - 64 pager - 16 gap - 40 header = 620 -> 10 rows of 61px.
    setViewportHeight(1000);
    const scene = mountTable({ top: 260, headerHeight: 40, rowHeight: 61, footerHeight: 64 });
    const { result } = renderHook(() => useResponsivePageSize(optionsFor(null, { enabled: false })));
    act(() => {
      result.current.tableRef(scene.wrapper);
      result.current.footerRef(scene.footer);
    });
    settle();
    expect(result.current.pageSize).toBe(10);
  });

  it("shrinks on a short viewport instead of keeping the fixed page", () => {
    setViewportHeight(800);
    // 800 - 260 - 64 - 16 - 40 = 420 -> 6 rows of 61px.
    const scene = mountTable({ top: 260, headerHeight: 40, rowHeight: 61, footerHeight: 64 });
    const { result } = renderHook(() => useResponsivePageSize(optionsFor(null, { enabled: false })));
    act(() => {
      result.current.tableRef(scene.wrapper);
      result.current.footerRef(scene.footer);
    });
    settle();
    expect(result.current.pageSize).toBe(6);
  });

  it("keeps a floor of five rows and the endpoint ceiling", () => {
    setViewportHeight(400);
    const scene = mountTable({ top: 260, headerHeight: 40, rowHeight: 61, footerHeight: 64 });
    const { result } = renderHook(() => useResponsivePageSize(optionsFor(null, { enabled: false, max: 100 })));
    act(() => {
      result.current.tableRef(scene.wrapper);
      result.current.footerRef(scene.footer);
    });
    settle();
    expect(result.current.pageSize).toBe(5);
  });

  it("answers the fixed page size while no table is attached", () => {
    const { result } = renderHook(() => useResponsivePageSize(optionsFor(null, { enabled: false, min: 10 })));
    settle();
    expect(result.current.pageSize).toBe(10);
  });

  it("keeps the measured rows while the table is detached for a loading state", () => {
    // /customers in table view: the measured rows become `limit`, the new page
    // loads behind a skeleton, and the table unmounts for that commit. Collapsing
    // the answer back to `min` there changes `limit` again, which refetches and
    // unmounts once more: the page size then oscillates between the two values.
    setViewportHeight(1000);
    const scene = mountTable({ top: 260, headerHeight: 40, rowHeight: 61, footerHeight: 64 });
    const { result } = renderHook(() =>
      useResponsivePageSize(optionsFor(null, { enabled: false, min: 5 })),
    );
    act(() => {
      result.current.tableRef(scene.wrapper);
      result.current.footerRef(scene.footer);
    });
    settle();
    // 1000 - 260 - 64 - 16 - 40 = 620 -> 10 rows of 61px, well above `min`.
    expect(result.current.pageSize).toBe(10);

    act(() => {
      result.current.tableRef(null);
    });
    expect(result.current.pageSize).toBe(10);

    // Remounting something else still re-measures: the last value is kept, not frozen.
    // 620 -> 6 rows of 100px.
    const shorter = mountTable({ top: 260, headerHeight: 40, rowHeight: 100, footerHeight: 64 });
    act(() => {
      result.current.tableRef(shorter.wrapper);
    });
    settle();
    expect(result.current.pageSize).toBe(6);
  });
});
