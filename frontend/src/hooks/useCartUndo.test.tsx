import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { CART_UNDO_WINDOW_MS, useCartUndo } from "./useCartUndo";

type Line = { productId: string; name: string; quantity: number };

const line = (productId: string, quantity = 1): Line => ({
  productId,
  name: `Producto ${productId}`,
  quantity,
});

/**
 * The hook deliberately owns neither the cart nor the setter: the POS page keeps
 * both. This harness is the same contract the page will use.
 */
function harness(initial: Line[], options: { locked?: boolean } = {}) {
  return renderHook(() => {
    const [cart, setCart] = useState<Line[]>(initial);
    const undo = useCartUndo(cart, setCart, {
      isLocked: () => options.locked === true,
    });
    return { cart, undo };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCartUndo", () => {
  it("removes the line and offers it back", () => {
    const { result } = harness([line("a"), line("b")]);

    act(() => result.current.undo.removeLine("a"));

    expect(result.current.cart.map((item) => item.productId)).toEqual(["b"]);
    expect(result.current.undo.lastRemoval?.item.productId).toBe("a");
  });

  it("restores the line at the position it had", () => {
    const { result } = harness([line("a"), line("b"), line("c")]);

    act(() => result.current.undo.removeLine("b"));
    act(() => result.current.undo.undoRemove());

    expect(result.current.cart.map((item) => item.productId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("clears the offer once the window elapses", () => {
    const { result } = harness([line("a")]);

    act(() => result.current.undo.removeLine("a"));
    act(() => {
      vi.advanceTimersByTime(CART_UNDO_WINDOW_MS);
    });

    expect(result.current.undo.lastRemoval).toBeNull();
  });

  it("keeps the last removal only, and the newer window wins", () => {
    const { result } = harness([line("a"), line("b")]);

    act(() => result.current.undo.removeLine("a"));
    act(() => result.current.undo.removeLine("b"));

    expect(result.current.undo.lastRemoval?.item.productId).toBe("b");
    // The first removal's timer must not wipe the second offer early.
    act(() => {
      vi.advanceTimersByTime(CART_UNDO_WINDOW_MS - 1);
    });
    expect(result.current.undo.lastRemoval?.item.productId).toBe("b");
  });

  it("never duplicates a product that came back on its own", () => {
    const { result } = harness([line("a")]);

    act(() => result.current.undo.removeLine("a"));
    act(() => result.current.undo.apply([line("a", 3)]));
    act(() => result.current.undo.undoRemove());

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0].quantity).toBe(3);
  });

  it("does nothing while the cart is locked", () => {
    const { result } = harness([line("a")], { locked: true });

    act(() => result.current.undo.removeLine("a"));

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.undo.lastRemoval).toBeNull();
  });

  it("ignores a removal of a product that is not in the cart", () => {
    const { result } = harness([line("a")]);

    act(() => result.current.undo.removeLine("z"));

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.undo.lastRemoval).toBeNull();
  });

  it("undoing with no offer in hand is a no-op", () => {
    const { result } = harness([line("a")]);

    act(() => result.current.undo.undoRemove());

    expect(result.current.cart).toHaveLength(1);
  });
});
