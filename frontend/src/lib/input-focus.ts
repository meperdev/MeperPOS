/**
 * Whether a text field is allowed to take focus on its own.
 *
 * On a phone or a tablet the primary pointer is a finger: focusing a field
 * raises the software keyboard, which covers the content the reader has not
 * seen yet and looks nothing like an app. On a desktop the POS scanner is a
 * keyboard devices type into, so the field must already own the focus when the
 * page becomes ready.
 *
 * One helper for one rule: every autofocus site asks this instead of copying a
 * media query, so a new field cannot silently miss it. An explicit user action
 * (tapping a field, clearing a search) may focus anything on any pointer — this
 * only covers focus the app gives away by itself.
 */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function shouldAutoFocusTextInput(): boolean {
  if (typeof window === "undefined") return true;
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia(COARSE_POINTER_QUERY).matches;
}
