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
    expect(mainElement).toHaveClass("lg:ml-[320px]");

    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(mainElement).toHaveClass("lg:ml-[72px]");

    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(mainElement).toHaveClass("lg:ml-[320px]");
  });

  // Pins the safe-area composition of the content column. jsdom resolves
  // `env()` to nothing, so the class name is the only observable here: this is
  // a regression pin, not visual proof. Dropping the inset has to fail a test
  // rather than reach a notched device unnoticed.
  it("keeps the content column clear of the notch and the home indicator", () => {
    setUser("ADMIN");

    const { container } = render(
      <DashboardLayout>
        <p>Contenido</p>
      </DashboardLayout>
    );

    const mainElement = container.querySelector("main");
    expect(mainElement?.className).toContain("pt-[calc(5rem+var(--safe-top))]");
    expect(mainElement?.className).toContain(
      "pb-[calc(1.5rem+var(--safe-bottom))]"
    );
    expect(mainElement?.className).toContain(
      "pl-[calc(1rem+var(--safe-left))]"
    );
    expect(mainElement?.className).toContain(
      "pr-[calc(1rem+var(--safe-right))]"
    );
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
});
