import type { KeyboardEvent } from "react";

/**
 * Props that turn a clickable card or table row into a keyboard-reachable
 * button, so it can replace a separate "Ver detalle" control. Keys pressed on a
 * nested control (receipt, download, menu) never open the row.
 */
export function activationProps(onActivate: () => void, label: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    },
  };
}
