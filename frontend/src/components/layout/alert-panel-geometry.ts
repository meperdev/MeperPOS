/**
 * Placement math for the alerts panel.
 *
 * The bell is reachable from two very different places: the mobile header (top
 * of the screen) and the rail footer (bottom of the sidebar). A single
 * "open below the anchor" rule works for the first and cuts the panel off for
 * the second, so the geometry is computed here, away from the component, and
 * always returns a height cap that fits the current viewport.
 */

import { RAIL_FLYOUT_GAP } from "@/lib/constants";

export const ALERT_PANEL_WIDTH = 352;
const EDGE = 12;
/** Below this much room the panel prefers growing upward instead. */
const PREFER_BELOW_MIN = 320;
/** Floor so a very short viewport still yields a usable scroll area. */
const MIN_PANEL_HEIGHT = 200;

export interface AlertPanelAnchor {
  /** Viewport-relative top edge of the trigger. */
  top: number;
  /** Viewport-relative bottom edge of the trigger. */
  bottom: number;
}

export interface AlertPanelGeometry {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export function computeAlertPanelGeometry({
  anchor,
  viewportWidth,
  viewportHeight,
  railRight,
}: {
  anchor: AlertPanelAnchor;
  viewportWidth: number;
  viewportHeight: number;
  railRight: number;
}): AlertPanelGeometry {
  // Snug to the rail's right edge, never overlapping it, never off screen.
  // The same gap the account flyout uses: the two panels open from the same
  // rail and must line up, or one reads as a pixel off.
  const left = Math.max(
    EDGE,
    Math.min(railRight + RAIL_FLYOUT_GAP, viewportWidth - ALERT_PANEL_WIDTH - EDGE),
  );

  const spaceBelow = viewportHeight - anchor.top - EDGE;
  const spaceAbove = anchor.bottom - EDGE;

  if (spaceBelow < PREFER_BELOW_MIN && spaceAbove > spaceBelow) {
    const bottom = Math.max(EDGE, viewportHeight - anchor.bottom);
    return {
      left,
      bottom,
      maxHeight: Math.max(
        MIN_PANEL_HEIGHT,
        Math.min(spaceAbove - 8, viewportHeight - bottom - EDGE),
      ),
    };
  }

  const top = Math.max(EDGE, anchor.top - 4);
  return {
    left,
    top,
    maxHeight: Math.max(MIN_PANEL_HEIGHT, viewportHeight - top - EDGE),
  };
}
