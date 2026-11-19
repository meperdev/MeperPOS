import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardLayout } from "./DashboardLayout";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const useAuthMock = vi.fn();
let currentPathname = "/expenses";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => currentPathname,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./Sidebar", () => ({
  Sidebar: () => null,
}));

// The header and the palette are surfaces with their own suites; the shell only
// owes them a slot and the rail's collapsed state.
vi.mock("./AppHeader", () => ({
  AppHeader: ({ isCollapsed }: { isCollapsed: boolean }) => (
    <div data-testid="app-header" data-collapsed={String(isCollapsed)} />
  ),
}));

vi.mock("./CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

// The tab bar is the shell's other navigation surface; it renders real links,
// and this suite is about the shell's geometry and gating, not Next's router.
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

// The banner itself is covered in its own file; here only its mount matters.
vi.mock("@/components/pwa/ConnectionStatus", () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}));

function setUser(role: string) {
  useAuthMock.mockReturnValue({
    isAuthenticated: true,
    loading: false,
    user: { id: "user-1", name: "Ana Perez", role, active: true },
    organization: undefined,
  });
}

describe("employee route access", () => {
  beforeEach(() => { vi.clearAllMocks(); currentPathname = "/employees"; });
  afterEach(cleanup);

  it.each(["OWNER", "ADMIN"])("allows %s", (role) => {
    setUser(role);
    render(<DashboardLayout>Empleados</DashboardLayout>);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it.each([["CASHIER", "/pos"], ["MEMBER", "/dashboard"], ["INVENTORY_USER", "/dashboard"], ["SUPER_ADMIN", "/dashboard"]])("redirects %s", (role, destination) => {
    setUser(role);
    render(<DashboardLayout>Empleados</DashboardLayout>);
    expect(replaceMock).toHaveBeenCalledWith(destination);
  });
});

describe("payroll route access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = "/payroll";
  });

  afterEach(() => {
    cleanup();
  });

  it.each(["OWNER", "ADMIN"])("allows %s", (role) => {
    setUser(role);
    render(<DashboardLayout>Nómina</DashboardLayout>);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it.each([
    ["CASHIER", "/pos"],
    ["MEMBER", "/dashboard"],
    ["INVENTORY_USER", "/dashboard"],
    ["SUPER_ADMIN", "/dashboard"],
  ])("redirects %s", (role, destination) => {
    setUser(role);
    render(<DashboardLayout>Nómina</DashboardLayout>);
    expect(replaceMock).toHaveBeenCalledWith(destination);
  });
});

describe("DashboardLayout route gating for /expenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = "/expenses";
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps ADMIN users on /expenses", () => {
    setUser("ADMIN");

    render(
      <DashboardLayout>
        <p>Salidas</p>
      </DashboardLayout>
    );

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects CASHIER users away from /expenses to /pos", () => {
    setUser("CASHIER");

    render(
      <DashboardLayout>
        <p>Salidas</p>
      </DashboardLayout>
    );

    expect(replaceMock).toHaveBeenCalledWith("/pos");
  });

  it("redirects INVENTORY_USER users away from /expenses to /dashboard", () => {
    setUser("INVENTORY_USER");

    render(
      <DashboardLayout>
        <p>Salidas</p>
      </DashboardLayout>
    );

    expect(replaceMock).toHaveBeenCalledWith("/dashboard");
  });

  it("does not redirect when the pathname is not gated", () => {
    currentPathname = "/profile";
    setUser("CASHIER");

    render(
      <DashboardLayout>
        <p>Perfil</p>
      </DashboardLayout>
    );

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("keeps Team & Access ADMIN-only", () => {
    currentPathname = "/settings/team";
    setUser("CASHIER");

    render(
      <DashboardLayout>
        <p>Equipo y acceso</p>
      </DashboardLayout>
    );

    expect(replaceMock).toHaveBeenCalledWith("/pos");
  });

  it("keeps the shell on screen while the session restores instead of blanking the page", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      loading: true,
      user: null,
      organization: undefined,
    });

    const { container } = render(
      <SidebarProvider>
        <DashboardLayout>
          <p>Contenido</p>
        </DashboardLayout>
      </SidebarProvider>
    );

    // The chrome stays: no full-page spinner, no redirect while restoring.
    expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
    expect(container.querySelector("main")).toHaveClass("lg:ml-[256px]");
    expect(screen.queryByText("Contenido")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("swaps the skeleton for the real shell once the session is restored", () => {
    setUser("ADMIN");

    render(
      <SidebarProvider>
        <DashboardLayout>
          <p>Contenido</p>
        </DashboardLayout>
      </SidebarProvider>
    );

    expect(screen.queryByTestId("app-shell-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("Contenido")).toBeInTheDocument();
  });

  it("synchronizes the desktop left margin with the collapsed sidebar state", async () => {
    setUser("ADMIN");

    function ToggleProbe() {
      const { toggleCollapse } = useSidebar();
      return <button onClick={toggleCollapse}>Toggle</button>;
    }

    const { container } = render(
      <SidebarProvider>
        <ToggleProbe />
        <DashboardLayout>
          <p>Contenido</p>
        </DashboardLayout>
      </SidebarProvider>
    );

    const mainElement = container.querySelector("main");
    expect(mainElement).toHaveClass("lg:ml-[256px]");

    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(mainElement).toHaveClass("lg:ml-[72px]");

    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(mainElement).toHaveClass("lg:ml-[256px]");
  });

  // Pins the safe-area composition of the content column. jsdom resolves
  // `env()` to nothing, so the class name is the only observable here: this is
  // a regression pin, not visual proof. Dropping the inset has to fail a test
  // rather than reach a notched device unnoticed.
  it("makes the main column fill the viewport so a page can pin its paginator to the bottom", () => {
    setUser("ADMIN");

    const { container } = render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    const mainElement = container.querySelector("main")!;
    expect(mainElement.className).toMatch(/\bflex\b/);
    expect(mainElement.className).toContain("flex-col");
    // dvh, not screen: an installed PWA has no collapsing browser chrome, and
    // 100vh is the height the URL bar covers.
    expect(mainElement.className).toContain("min-h-dvh");
    expect(mainElement.className).not.toContain("min-h-screen");

    const column = mainElement.firstElementChild as HTMLElement;
    expect(column.className).toContain("flex-1");
    expect(column.className).toContain("flex-col");
    expect(column.querySelector("p")!.parentElement).toBe(column);
  });

  it("fills exactly the height the header leaves, so a short page does not scroll", () => {
    setUser("ADMIN");

    const { container } = render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    const mainElement = container.querySelector("main")!;
    // The sticky bar owns the top of the viewport; without this cap the
    // document would be one header taller than the screen on every page that
    // fits inside it.
    expect(mainElement.className).toContain(
      "lg:min-h-[calc(100dvh-var(--app-header-height))]"
    );
  });

  it("keeps the content column clear of the notch, the home indicator and the tab bar", () => {    setUser("ADMIN");

    const { container } = render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    const mainElement = container.querySelector("main");
    expect(mainElement?.className).toContain(
      "pt-[calc(var(--mobile-header)+var(--mobile-header-gap)+var(--safe-top))]"
    );
    expect(mainElement?.className).toContain(
      "pb-[calc(var(--mobile-tabbar)+var(--safe-bottom)+var(--mobile-content-bottom-gap))]"
    );
    expect(mainElement?.className).toContain(
      "pl-[calc(1rem+var(--safe-left))]"
    );
    expect(mainElement?.className).toContain(
      "pr-[calc(1rem+var(--safe-right))]"
    );
  });

  it("renders the mobile tab bar so the sections stay one tap away", () => {
    setUser("OWNER");

    render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    expect(
      screen.getByRole("navigation", { name: "Secciones principales" })
    ).toBeInTheDocument();
  });

  it("mounts the connection warning on every authenticated route", () => {
    setUser("ADMIN");

    render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    expect(screen.getByTestId("connection-status")).toBeInTheDocument();
  });

  it("mounts the desktop header above the content column", () => {
    setUser("ADMIN");

    render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    expect(screen.getByTestId("app-header")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
  });

  it("hands the header the rail's collapsed state", async () => {
    setUser("ADMIN");

    function ToggleProbe() {
      const { toggleCollapse } = useSidebar();
      return <button onClick={toggleCollapse}>Toggle</button>;
    }

    render(
      <SidebarProvider>
        <ToggleProbe />
        <DashboardLayout>
          <p>Contenido</p>
        </DashboardLayout>
      </SidebarProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));

    expect(screen.getByTestId("app-header")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  it("mounts one command palette for the whole shell", () => {
    setUser("ADMIN");

    render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    expect(screen.getAllByTestId("command-palette")).toHaveLength(1);
  });

  it("keeps the header off the skeleton while the session restores", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      loading: true,
      user: null,
      organization: undefined,
    });

    render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    expect(screen.getByTestId("app-shell-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
  });
});
