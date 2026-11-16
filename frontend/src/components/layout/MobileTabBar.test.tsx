import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileTabBar } from "./MobileTabBar";
import { Sidebar } from "./Sidebar";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { closeMobileDrawer } from "./mobile-drawer";

const useAuthMock = vi.fn();
let currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

// The bell is another surface with its own suite; here only its slot matters.
vi.mock("@/components/layout/AlertCenter", () => ({
  AlertCenter: () => <button type="button" aria-label="Notificaciones" />,
}));

function setUser(role: string) {
  useAuthMock.mockReturnValue({
    user: {
      id: "user-1",
      name: "Ana Perez",
      role,
      active: true,
      organizationId: "org-a",
    },
    logout: vi.fn(),
    switchOrganization: vi.fn(),
  });
}

function tabBar() {
  return screen.getByRole("navigation", { name: "Secciones principales" });
}

function tabLabels() {
  return within(tabBar())
    .getAllByRole("link")
    .map((link) => link.textContent?.trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  currentPathname = "/dashboard";
  closeMobileDrawer();
});

afterEach(cleanup);

describe("MobileTabBar visibility follows the rail's access rules", () => {
  it("gives an owner the five approved tabs, in order", () => {
    setUser("OWNER");
    render(<MobileTabBar />);

    expect(tabLabels()).toEqual(["Panel", "POS", "Ventas", "Inventario"]);
    expect(
      within(tabBar()).getByRole("button", { name: "Más" }),
    ).toBeInTheDocument();
  });

  it("drops Panel for a cashier, who cannot open the dashboard", () => {
    setUser("CASHIER");
    render(<MobileTabBar />);

    expect(tabLabels()).toEqual(["POS", "Ventas", "Inventario"]);
  });

  it("gives an inventory user Panel and Inventario only", () => {
    setUser("INVENTORY_USER");
    render(<MobileTabBar />);

    expect(tabLabels()).toEqual(["Panel", "Inventario"]);
  });

  it("keeps Más as the only escape hatch when no tab is open to the role", () => {
    setUser("GUEST");
    render(<MobileTabBar />);

    // Unknown roles inherit nothing, so every section icon disappears and the
    // drawer stays the one way into the rest of the app.
    expect(within(tabBar()).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(tabBar()).getByRole("button", { name: "Más" }),
    ).toBeInTheDocument();
  });
});

describe("MobileTabBar active state", () => {
  it("marks the section of a nested route and leaves its siblings alone", () => {
    setUser("OWNER");
    currentPathname = "/sales/abc";
    render(<MobileTabBar />);

    expect(within(tabBar()).getByRole("link", { name: "Ventas" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabBar()).getByRole("link", { name: "Panel" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(within(tabBar()).getByRole("button", { name: "Más" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks nothing when the current section has no tab", () => {
    setUser("OWNER");
    currentPathname = "/settings/team";
    render(<MobileTabBar />);

    for (const link of within(tabBar()).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});

describe("MobileTabBar opens the one navigation drawer", () => {
  function renderShell() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <Sidebar />
          <MobileTabBar />
        </SidebarProvider>
      </QueryClientProvider>,
    );
    return document.querySelector<HTMLElement>("[data-sidebar-root]")!;
  }

  it("opens the sidebar's drawer from Más and reports it to assistive tech", async () => {
    setUser("OWNER");
    const drawer = renderShell();

    expect(drawer).toHaveAttribute("data-state", "closed");
    const more = within(tabBar()).getByRole("button", { name: "Más" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more);

    expect(drawer).toHaveAttribute("data-state", "open");
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the drawer again from Más", async () => {
    setUser("OWNER");
    const drawer = renderShell();
    const more = within(tabBar()).getByRole("button", { name: "Más" });

    await userEvent.click(more);
    await userEvent.click(more);

    expect(drawer).toHaveAttribute("data-state", "closed");
  });

  it("closes from a control inside the drawer, sized for a thumb", async () => {
    setUser("OWNER");
    const drawer = renderShell();

    await userEvent.click(within(tabBar()).getByRole("button", { name: "Más" }));
    const close = await screen.findByRole("button", { name: "Cerrar menú" });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");

    await userEvent.click(close);

    expect(drawer).toHaveAttribute("data-state", "closed");
  });

  it("closes on Escape", async () => {
    setUser("OWNER");
    const drawer = renderShell();

    await userEvent.click(within(tabBar()).getByRole("button", { name: "Más" }));
    expect(drawer).toHaveAttribute("data-state", "open");

    await userEvent.keyboard("{Escape}");

    expect(drawer).toHaveAttribute("data-state", "closed");
  });
});

describe("MobileTabBar placement", () => {
  it("is a fixed, opaque bar that pays the home indicator and stays under lg", () => {
    setUser("OWNER");
    render(<MobileTabBar />);

    const bar = tabBar();
    expect(bar.className).toContain("lg:hidden");
    expect(bar.className).toContain("fixed");
    expect(bar.className).toContain("bottom-0");
    // D5: a solid card fill and a hairline, never a translucent blur.
    expect(bar.className).toContain("bg-card");
    expect(bar.className).not.toContain("backdrop-blur");
    expect(bar.className).toContain(
      "h-[calc(var(--mobile-tabbar)+var(--safe-bottom))]",
    );
    expect(bar.className).toContain("pb-[var(--safe-bottom)]");
  });

  it("gives every target a pressed state and at least 44px of height", () => {
    setUser("OWNER");
    render(<MobileTabBar />);

    for (const target of [
      ...within(tabBar()).getAllByRole("link"),
      within(tabBar()).getByRole("button", { name: "Más" }),
    ]) {
      expect(target.className).toContain("active:");
      expect(target.className).toMatch(/\bmin-h-11\b/);
    }
  });

  it("keeps its own snapshot, so a route change never fades the bar", () => {
    setUser("OWNER");
    render(<MobileTabBar />);

    expect(tabBar().className).toContain(
      "[view-transition-name:mobile-tab-bar]",
    );
  });
});
