import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { BackGestureGuard } from "./BackGestureGuard";

const isStandaloneMock = vi.fn();
let currentPathname = "/dashboard";

vi.mock("@/lib/install-prompt", () => ({
  isStandaloneDisplay: () => isStandaloneMock(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

function firePopState() {
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

beforeEach(() => {
  isStandaloneMock.mockReturnValue(true);
  currentPathname = "/dashboard";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("BackGestureGuard", () => {
  it("leaves one entry behind a guarded route so the swipe has nowhere to exit", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    render(<BackGestureGuard />);

    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("re-arms after the gesture consumed the entry", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<BackGestureGuard />);
    pushState.mockClear();

    firePopState();

    // Without this the second swipe would leave: the guard has to keep putting
    // the entry back, not just place it once.
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way in a browser tab", () => {
    isStandaloneMock.mockReturnValue(false);
    const pushState = vi.spyOn(window.history, "pushState");

    render(<BackGestureGuard />);

    // In a tab the back button belongs to the browser.
    expect(pushState).not.toHaveBeenCalled();
  });

  it("does not trap internal navigation", () => {
    currentPathname = "/inventory";
    const pushState = vi.spyOn(window.history, "pushState");

    render(<BackGestureGuard />);

    // Every non-root route must keep popping back normally.
    expect(pushState).not.toHaveBeenCalled();
  });

  it.each(["/", "/login", "/register", "/dashboard", "/pos"])(
    "guards %s",
    (path) => {
      currentPathname = path;
      const pushState = vi.spyOn(window.history, "pushState");

      render(<BackGestureGuard />);

      expect(pushState).toHaveBeenCalledTimes(1);
    }
  );

  it("arms for the guarded route the app actually opened on", () => {
    currentPathname = "/login";
    const pushState = vi.spyOn(window.history, "pushState");

    render(<BackGestureGuard />);

    // This is the case the owner hit: the swipe from the login screen closed
    // the app before there was anything to navigate back to.
    expect(pushState).toHaveBeenCalledTimes(1);
  });
});
