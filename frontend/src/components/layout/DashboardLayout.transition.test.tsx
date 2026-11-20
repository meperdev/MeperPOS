import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardLayout } from "./DashboardLayout";

// The section transition is driven by the pathname alone: navigating to a
// different section replays the enter animation, while a query-string change
// (filters, pagination) must leave the mounted content untouched.
const nav = vi.hoisted(() => ({ pathname: "/expenses", search: "" }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/billing/PlanLimitBanner", () => ({
  PlanLimitBanner: () => null,
}));

vi.mock("@/components/pwa/ConnectionStatus", () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}));

/** Holds local state: a remount clears the field, so it proves identity. */
function StateProbe() {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label="probe"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function renderLayout(children: React.ReactNode) {
  return render(<DashboardLayout>{children}</DashboardLayout>);
}

function enterWrapper(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-page-enter]");
}

describe("section enter animation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.pathname = "/expenses";
    nav.search = "";
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      loading: false,
      user: { id: "user-1", name: "Ana Perez", role: "ADMIN", active: true },
      organization: undefined,
    });
  });

  afterEach(cleanup);

  it("wraps only the page content in an element that carries the enter animation", () => {
    const { container } = renderLayout(<p>Contenido</p>);

    const enter = enterWrapper(container);
    expect(enter).not.toBeNull();
    expect(enter).toHaveClass("animate-page-enter");
    expect(enter).toContainElement(screen.getByText("Contenido"));

    // The shell does not animate with it.
    expect(enter).not.toContainElement(screen.getByTestId("connection-status"));
    expect(enter).not.toContainElement(screen.getByTestId("sidebar"));
    expect(container.querySelector("main")).toContainElement(enter);
  });

  it("keeps the same enter element when only the query string changes", async () => {
    const { container, rerender } = renderLayout(<StateProbe />);

    const enter = enterWrapper(container);
    expect(enter).not.toBeNull();
    await userEvent.type(screen.getByLabelText("probe"), "abc");

    // Filters and pagination live in the query string.
    nav.search = "?page=2&from=2026-11-01";
    rerender(
      <DashboardLayout>
        <StateProbe />
      </DashboardLayout>
    );

    expect(enterWrapper(container)).toBe(enter);
    expect(screen.getByLabelText("probe")).toHaveValue("abc");
  });

  it("remounts the content when the pathname changes so the animation replays", async () => {
    const { container, rerender } = renderLayout(<StateProbe />);

    const enter = enterWrapper(container);
    expect(enter).not.toBeNull();
    await userEvent.type(screen.getByLabelText("probe"), "abc");

    nav.pathname = "/customers";
    rerender(
      <DashboardLayout>
        <StateProbe />
      </DashboardLayout>
    );

    const next = enterWrapper(container);
    expect(next).not.toBeNull();
    expect(next).not.toBe(enter);
    expect(next).toHaveClass("animate-page-enter");
    expect(screen.getByLabelText("probe")).toHaveValue("");
  });

  it("leaves the shell mounted across a pathname change", () => {
    const { container, rerender } = renderLayout(<p>Contenido</p>);

    const sidebar = screen.getByTestId("sidebar");

    nav.pathname = "/customers";
    rerender(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    expect(screen.getByTestId("sidebar")).toBe(sidebar);
    expect(enterWrapper(container)).not.toBeNull();
  });
});

// jsdom does not run animations, so the motion contract is pinned against the
// stylesheet the browser actually loads.
describe("page-enter motion contract", () => {
  const globalsCss = readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8"
  );
  const withoutComments = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");

  function ruleBody(selector: string) {
    const start = withoutComments.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    // Balanced braces: a keyframe block contains nested from/to blocks.
    let depth = 0;
    let end = withoutComments.indexOf("{", start);
    for (let index = end; index < withoutComments.length; index += 1) {
      if (withoutComments[index] === "{") depth += 1;
      if (withoutComments[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    return withoutComments.slice(start + selector.length, end);
  }

  it("defines a short, small rise", () => {
    const keyframes = ruleBody("@keyframes page-enter");
    expect(keyframes).toContain("opacity: 0;");
    expect(keyframes).toContain("translateY(6px);");
    expect(keyframes).toContain("translateY(0);");
  });

  it("ends without a transform so a fixed descendant keeps the viewport", () => {
    const body = ruleBody(".animate-page-enter");
    expect(body).toContain(
      "animation: page-enter 220ms cubic-bezier(0.22, 1, 0.36, 1);"
    );
    // `backwards` fills the start of the animation and leaves no resting style:
    // a fill of `both`/`forwards` would keep a containing block alive and break
    // every `position: fixed` modal, drawer and cart bar under the content.
    expect(body).toContain("animation-fill-mode: backwards;");
    expect(body).not.toContain("will-change");
    expect(body).not.toContain("opacity: 0");
    expect(body).not.toContain("transform:");
  });

  it("is disabled when the reader asks for reduced motion", () => {
    const start = withoutComments.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThanOrEqual(0);
    const mediaBlock = withoutComments.slice(start);
    const firstGroup = mediaBlock.slice(0, mediaBlock.indexOf("}"));

    expect(firstGroup).toContain(".animate-page-enter");
    expect(firstGroup).toContain("animation: none;");
    expect(firstGroup).toContain("opacity: 1;");
    expect(firstGroup).toContain("transform: none;");
  });
});
