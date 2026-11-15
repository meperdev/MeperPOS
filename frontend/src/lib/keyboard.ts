import type { KeyboardEvent } from "react";

/**
 * Keyboard path for a clickable row or card that is not a native button.
 * Only the element itself activates: a key pressed on a nested control
 * (delete, copy, menu) must keep that control's own behaviour.
 */
export function activateOnKey<T extends HTMLElement>(onActivate: () => void) {
  return (event: KeyboardEvent<T>) => {
    if (isActivationKey(event)) onActivate();
  };
}

/**
 * Same rule as `activateOnKey`, as a predicate for inline handlers. Use it
 * when the action reads a ref: the React Compiler cannot prove that a
 * callback handed to `activateOnKey` during render is not called there.
 * Calls `preventDefault` when it returns true.
 */
export function isActivationKey<T extends HTMLElement>(event: KeyboardEvent<T>): boolean {
  if (event.target !== event.currentTarget) return false;
  if (event.key !== "Enter" && event.key !== " ") return false;
  event.preventDefault();
  return true;
}
