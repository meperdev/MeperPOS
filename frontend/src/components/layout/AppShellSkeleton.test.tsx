import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppShellSkeleton } from "./AppShellSkeleton";

afterEach(cleanup);

/**
 * S1.3: the first paint is the skeleton, so it has to reserve the same bars the
 * real shell draws — otherwise the swap is a jump. jsdom resolves no media
 * query, so the responsive contract is pinned by the class names.
 */
describe("AppShellSkeleton mobile geometry", () => {
  it("reserves the top bar at the shared header height", () => {
    render(<AppShellSkeleton isCollapsed={false} />);

    const header = document.querySelector("header")!;
    expect(header.className).toContain("lg:hidden");
    expect(header.className).toContain(
      "h-[calc(var(--mobile-header)+var(--safe-top))]",
    );
    expect(header.className).toContain("pt-[var(--safe-top)]");
  });

  it("reserves the tab bar strip above the home indicator", () => {
    render(<AppShellSkeleton isCollapsed={false} />);

    const tabBar = screen.getByTestId("app-shell-skeleton-tabbar");
    expect(tabBar.className).toContain("lg:hidden");
    expect(tabBar.className).toContain("fixed");
    expect(tabBar.className).toContain(
      "h-[calc(var(--mobile-tabbar)+var(--safe-bottom))]",
    );
    expect(tabBar.className).toContain("pb-[var(--safe-bottom)]");
    expect(tabBar.className).toContain("bg-card");
  });

  it("clears both bars in the content column, exactly like the real shell", () => {
    render(<AppShellSkeleton isCollapsed={false} />);

    const main = document.querySelector("main")!;
    expect(main.className).toContain(
      "pt-[calc(var(--mobile-header)+var(--mobile-header-gap)+var(--safe-top))]",
    );
    expect(main.className).toContain(
      "pb-[calc(var(--mobile-tabbar)+var(--safe-bottom)+var(--mobile-content-bottom-gap))]",
    );
    expect(main.className).toContain("min-h-dvh");
  });
});

describe("AppShellSkeleton desktop", () => {
  it("keeps the rail and its margin untouched", () => {
    const { container } = render(<AppShellSkeleton isCollapsed />);

    const rail = container.querySelector("aside")!;
    expect(rail.className).toContain("hidden lg:flex");
    expect(rail.className).toContain("w-[72px]");

    const main = document.querySelector("main")!;
    expect(main.className).toContain("lg:ml-[72px]");
    expect(main.className).toContain("lg:px-8");
    expect(main.className).toContain("lg:pb-8");
    expect(main.className).toContain("lg:pt-8");
  });
});
