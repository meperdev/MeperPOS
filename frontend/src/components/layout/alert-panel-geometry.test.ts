// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALERT_PANEL_WIDTH,
  computeAlertPanelGeometry,
  computeHeaderAlertPanelGeometry,
} from "./alert-panel-geometry";

/**
 * The panel was cut off at the bottom because it always opened downward from
 * the anchor. With the bell living in the rail footer, the panel has to grow
 * upward — and in every viewport the height cap must leave the panel fully on
 * screen, with the list scrolling inside it instead of overflowing.
 */

function panelTop(
  geometry: ReturnType<typeof computeAlertPanelGeometry>,
  viewportHeight: number,
): number {
  if (geometry.top !== undefined) return geometry.top;
  return viewportHeight - (geometry.bottom ?? 0) - geometry.maxHeight;
}

describe("computeAlertPanelGeometry", () => {
  it("grows upward when the bell sits in the rail footer", () => {
    const geometry = computeAlertPanelGeometry({
      anchor: { top: 800, bottom: 836 },
      viewportWidth: 1440,
      viewportHeight: 900,
      railRight: 320,
    });

    // Anchored by its bottom edge, right above the bell's row.
    expect(geometry.bottom).toBe(64);
    expect(geometry.top).toBeUndefined();
    // Same 12px gap the account flyout leaves from the rail.
    expect(geometry.left).toBe(332);
    expect(geometry.maxHeight).toBeGreaterThanOrEqual(200);
  });

  it("opens downward when there is room below the anchor", () => {
    const geometry = computeAlertPanelGeometry({
      anchor: { top: 60, bottom: 96 },
      viewportWidth: 1440,
      viewportHeight: 900,
      railRight: 320,
    });

    expect(geometry.top).toBe(56);
    expect(geometry.bottom).toBeUndefined();
    expect(geometry.maxHeight).toBe(832);
  });

  it("never lets the panel leave the viewport, at any height or anchor", () => {
    for (const viewportHeight of [600, 700, 768, 900, 1080, 1440]) {
      for (const anchorTop of [8, 120, 300, 600, viewportHeight - 40]) {
        const geometry = computeAlertPanelGeometry({
          anchor: { top: anchorTop, bottom: anchorTop + 36 },
          viewportWidth: 1280,
          viewportHeight,
          railRight: 320,
        });

        const top = panelTop(geometry, viewportHeight);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top + geometry.maxHeight).toBeLessThanOrEqual(viewportHeight);
      }
    }
  });

  it("keeps the panel inside the viewport horizontally on narrow screens", () => {
    const geometry = computeAlertPanelGeometry({
      anchor: { top: 500, bottom: 536 },
      viewportWidth: 380,
      viewportHeight: 700,
      railRight: 300,
    });

    expect(geometry.left).toBeGreaterThanOrEqual(12);
    expect(geometry.left + 352).toBeLessThanOrEqual(380);
  });
});

/**
 * The desktop header mounts the same bell at the top of the screen. There the
 * rail's flyout math puts the panel over the header itself, hiding the bell and
 * the avatar it sits next to, so the header placement hangs the panel under its
 * own trigger and lines its right edge up with the account menu.
 */
describe("computeHeaderAlertPanelGeometry", () => {
  it("hangs the panel below the bell, right-aligned with the header actions", () => {
    const geometry = computeHeaderAlertPanelGeometry({
      anchor: { top: 12, bottom: 44 },
      alignRight: 1566,
      viewportWidth: 1590,
      viewportHeight: 913,
    });

    // 8px under the trigger, never over it.
    expect(geometry.top).toBe(52);
    expect(geometry.bottom).toBeUndefined();
    // The account menu's right edge is the same line the panel ends on.
    expect(geometry.left + ALERT_PANEL_WIDTH).toBe(1566);
    // Same width as the rail flyout, so the two bells read as one panel.
    expect(ALERT_PANEL_WIDTH).toBe(352);
    // The cap stops short of the viewport floor; the list scrolls inside.
    expect(geometry.top! + geometry.maxHeight).toBeLessThanOrEqual(913 - 12);
    expect(geometry.maxHeight).toBeGreaterThanOrEqual(200);
  });

  it("never covers the bell, at any header height", () => {
    for (const viewportHeight of [768, 913, 1440]) {
      for (const anchorTop of [4, 8, 12, 16]) {
        const anchor = { top: anchorTop, bottom: anchorTop + 32 };
        const geometry = computeHeaderAlertPanelGeometry({
          anchor,
          alignRight: 900,
          viewportWidth: 1366,
          viewportHeight,
        });

        expect(geometry.top!).toBeGreaterThanOrEqual(anchor.bottom + 8);
        expect(geometry.top! + geometry.maxHeight).toBeLessThanOrEqual(
          viewportHeight,
        );
      }
    }
  });

  it("stays inside the viewport when the header's edge is narrow", () => {
    const geometry = computeHeaderAlertPanelGeometry({
      anchor: { top: 8, bottom: 40 },
      alignRight: 300,
      viewportWidth: 380,
      viewportHeight: 700,
    });

    expect(geometry.left).toBe(12);
    expect(geometry.left + ALERT_PANEL_WIDTH).toBeLessThanOrEqual(380);
    expect(geometry.top! + geometry.maxHeight).toBeLessThanOrEqual(700);
  });
});
