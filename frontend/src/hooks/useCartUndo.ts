"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long the offer stays available before the removal becomes final. */
export const CART_UNDO_WINDOW_MS = 6000;

type Identified = { productId: string };

export type RemovedLine<T> = { item: T; index: number };

type CartUndo<T> = {
  /** The removal the operator can still take back, if any. */
  lastRemoval: RemovedLine<T> | null;
  /** Removes a line and opens the undo window. */
  removeLine: (productId: string) => void;
  /** Puts the last removed line back where it was. */
  undoRemove: () => void;
  /** Drops the offer without restoring anything. */
  clearUndo: () => void;
  /**
   * Applies a change that already knows the line is gone (a re-add from the
   * catalogue, a reprice). Not offered for undo.
   */
  apply: (next: T[]) => void;
};

/**
 * Removal in a cart that a thumb can hit by accident.
 *
 * A POS cart is edited at speed, on a phone, with the keyboard coming and going:
 * the row moves under the finger and a tap lands on "−" or on the bin. Deleting
 * a line is cheap to make reversible and expensive to lose mid-sale, so every
 * removal opens a short window in which it can be taken back.
 *
 * The hook owns the offer, not the cart: the page keeps its own state and setter
 * so nothing else about the cart changes.
 */
export function useCartUndo<T extends Identified>(
  cart: T[],
  setCart: (updater: (prev: T[]) => T[]) => void,
  options: { isLocked?: () => boolean } = {}
): CartUndo<T> {
  const [lastRemoval, setLastRemoval] = useState<RemovedLine<T> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocked = options.isLocked;

  const clearTimer = useCallback(() => {
    if (timeoutRef.current === null) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const clearUndo = useCallback(() => {
    clearTimer();
    setLastRemoval(null);
  }, [clearTimer]);

  // A timer that outlives the page would call setState on nothing.
  useEffect(() => clearTimer, [clearTimer]);

  const removeLine = useCallback(
    (productId: string) => {
      if (isLocked?.()) return;

      const index = cart.findIndex((item) => item.productId === productId);
      if (index === -1) return;

      const item = cart[index];
      setCart((prev) => prev.filter((entry) => entry.productId !== productId));

      // One offer at a time: a second removal replaces the first, and its own
      // window starts now, so the newer undo is never cut short by the older.
      clearTimer();
      setLastRemoval({ item, index });
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setLastRemoval(null);
      }, CART_UNDO_WINDOW_MS);
    },
    [cart, setCart, isLocked, clearTimer]
  );

  const undoRemove = useCallback(() => {
    if (!lastRemoval) return;
    const { item, index } = lastRemoval;

    setCart((prev) => {
      // The product may have come back through the catalogue while the offer
      // was open. Restoring it again would silently double the line.
      if (prev.some((entry) => entry.productId === item.productId)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });

    clearUndo();
  }, [lastRemoval, setCart, clearUndo]);

  const apply = useCallback(
    (next: T[]) => {
      setCart(() => next);
    },
    [setCart]
  );

  return { lastRemoval, removeLine, undoRemove, clearUndo, apply };
}
