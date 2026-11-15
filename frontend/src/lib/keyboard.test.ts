import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { activateOnKey } from "@/lib/keyboard";

function keyEvent(key: string, target: object, currentTarget: object) {
  const preventDefault = vi.fn();
  return {
    key,
    target,
    currentTarget,
    preventDefault,
  } as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("activateOnKey", () => {
  it("runs the action on Enter and Space and prevents the default scroll", () => {
    const onActivate = vi.fn();
    const handler = activateOnKey(onActivate);
    const card = {};

    for (const key of ["Enter", " "]) {
      const event = keyEvent(key, card, card);
      handler(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("ignores other keys", () => {
    const onActivate = vi.fn();
    const card = {};

    activateOnKey(onActivate)(keyEvent("Tab", card, card));

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("ignores keys pressed on a nested control, so Enter on delete never edits", () => {
    const onActivate = vi.fn();
    const card = {};
    const nestedDelete = {};

    activateOnKey(onActivate)(keyEvent("Enter", nestedDelete, card));

    expect(onActivate).not.toHaveBeenCalled();
  });
});
