import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  applyOrganizationScope,
  SIDEBAR_SCROLL_KEY,
} from "./Sidebar";
import { SidebarProvider, SIDEBAR_COLLAPSED_KEY } from "@/contexts/SidebarContext";
import { closeMobileDrawer, openMobileDrawer } from "./mobile-drawer";
import { safeGetItem, safeSetItem } from "@/lib/utils";
import { guardOrganizationScopeChange } from "@/lib/organizationScope";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import { api } from "@/lib/api";

const pushMock = vi.fn();
const switchOrganizationMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: pushMock }),
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

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

//
// A mounted consumer of a scoped list, so the test exercises an ACTIVE observer
// rather than only what happens to sit in the cache.
//
function ScopedRowsProbe() {
  const { data } = useQuery({
    queryKey: ["products", { page: 1, limit: 10 }],
    queryFn: () => Promise.resolve({ data: [] as Array<{ id: string }> }),
    staleTime: Infinity,
  });
  const rows = (data as { data: Array<{ id: string }> } | undefined)?.data ?? [];
  return (
    <div data-testid="scoped-rows">{rows.map((row) => row.id).join(",")}</div>
  );
}

const organizations = [
  {
    id: "org-a",
    name: "Org A",
    role: "ADMIN",
    plan: "BASIC",
    status: "ACTIVE",
  },
  {
    id: "org-b",
    name: "Org B",
    role: "MEMBER",
    plan: "PRO",
    status: "ACTIVE",
  },
];

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeSetItem(SIDEBAR_COLLAPSED_KEY, "false");
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
        name: "Ana Perez",
        role: "ADMIN",
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
  });

  it("renders the organization switcher for multi-org users", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    // The rail and the drawer each mount their own switcher (only one is on
    // screen at a time); the rail's is the reference here.
    const rail = within(screen.getByTestId("sidebar-user-rail"));
    await waitFor(() => {
      expect(rail.getByText("Org A")).toBeInTheDocument();
    });

    expect(rail.getByLabelText(/Cambiar organización/i)).toBeInTheDocument();
  });

  it("hides the organization switcher for single-org users", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    expect(
      screen.queryByLabelText(/Cambiar organización/i)
    ).not.toBeInTheDocument();
  });

  it("shows the Salidas nav item for ADMIN users", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    const link = screen.getByRole("link", { name: "Salidas" });
    expect(link).toHaveAttribute("href", "/expenses");
  });

  it("marks the current section with a soft primary tint and a primary icon", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    // pathname is mocked to /dashboard, so Panel is the current section.
    const active = screen.getByRole("link", { name: "Panel" });
    expect(active).toHaveClass("bg-primary-light/60", "text-foreground");
    expect(active.firstElementChild).toHaveClass("text-primary-text");
    expect(active).not.toHaveClass("bg-muted/70");

    const idle = screen.getByRole("link", { name: "Salidas" });
    expect(idle).not.toHaveClass("bg-primary-light/60");
    expect(idle.firstElementChild).toHaveClass("text-muted-foreground");
  });

  it("uses the approved operational order and keeps users out of the main sidebar", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/auth/organizations"));

    const links = screen.getAllByRole("link").map((link) => link.textContent?.trim());
    expect(links).toEqual([
      "Panel",
      "POS",
      "Ventas",
      "Clientes",
      "Inventario",
      "Categorías",
      "Proveedores",
      "Compras",
      "Transferencias",
      "Salidas",
      "Reportes",
      "Préstamos",
      "Empleados",
      "Nómina",
      "Tareas",
      "Sedes",
    ]);
    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
    // Account destinations live in the account menu, not in the rail spine.
    expect(screen.queryByRole("link", { name: "Mi perfil" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configuración" })).not.toBeInTheDocument();
  });

  it.each([
    ["OWNER", true], ["ADMIN", true], ["CASHIER", false],
    ["MEMBER", false], ["INVENTORY_USER", false], ["SUPER_ADMIN", false],
  ])("shows the employee link for %s only when permitted", async (role, permitted) => {
    useAuthMock.mockReturnValue({
      user: { id: "user-1", name: "Ana", role, active: true, organizationId: "org-a" },
      logout: vi.fn(), switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { organizations: [organizations[0]] } });
    render(<Sidebar />, { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const link = screen.queryByRole("link", { name: "Empleados" });
    if (permitted) expect(link).toHaveAttribute("href", "/employees");
    else expect(link).not.toBeInTheDocument();
  });

  it.each([
    ["OWNER", true], ["ADMIN", true], ["CASHIER", false],
    ["MEMBER", false], ["INVENTORY_USER", false], ["SUPER_ADMIN", false],
  ])("shows the payroll link for %s only when permitted", async (role, permitted) => {
    useAuthMock.mockReturnValue({
      user: { id: "user-1", name: "Ana", role, active: true, organizationId: "org-a" },
      logout: vi.fn(), switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { organizations: [organizations[0]] } });
    render(<Sidebar />, { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const link = screen.queryByRole("link", { name: "Nómina" });
    if (permitted) expect(link).toHaveAttribute("href", "/payroll");
    else expect(link).not.toBeInTheDocument();
  });

  it.each([
    ["OWNER", true], ["ADMIN", true], ["CASHIER", false],
    ["MEMBER", false], ["INVENTORY_USER", false], ["SUPER_ADMIN", false],
  ])("shows the sites link for %s only when permitted", async (role, permitted) => {
    useAuthMock.mockReturnValue({
      user: { id: "user-1", name: "Ana", role, active: true, organizationId: "org-a" },
      logout: vi.fn(), switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { organizations: [organizations[0]] } });
    render(<Sidebar />, { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const link = screen.queryByRole("link", { name: "Sedes" });
    if (permitted) expect(link).toHaveAttribute("href", "/locations");
    else expect(link).not.toBeInTheDocument();
  });

  it.each([
    ["OWNER", true], ["ADMIN", true], ["MEMBER", true],
    ["CASHIER", false], ["INVENTORY_USER", false], ["SUPER_ADMIN", true],
  ])("shows the transfers link for %s only when permitted", async (role, permitted) => {
    useAuthMock.mockReturnValue({
      user: { id: "user-1", name: "Ana", role, active: true, organizationId: "org-a" },
      logout: vi.fn(), switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { organizations: [organizations[0]] } });
    render(<Sidebar />, { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const link = screen.queryByRole("link", { name: "Transferencias" });
    if (permitted) expect(link).toHaveAttribute("href", "/transfers");
    else expect(link).not.toBeInTheDocument();
  });

  it("hides the Importar nav item now that it lives under Configuración", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    expect(screen.queryByRole("link", { name: "Importar" })).not.toBeInTheDocument();
  });

  it("hides the Salidas nav item for CASHIER users", async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: "user-2",
        name: "Carlos Cajero",
        role: "CASHIER",
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    expect(
      screen.queryByRole("link", { name: "Salidas" })
    ).not.toBeInTheDocument();
  });

  it("hides the Salidas nav item for INVENTORY_USER users", async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: "user-3",
        name: "Inventario User",
        role: "INVENTORY_USER",
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    expect(
      screen.queryByRole("link", { name: "Salidas" })
    ).not.toBeInTheDocument();
  });

  it("removes the previously scoped data when a SuperAdmin changes organization", async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: "admin-1",
        email: "admin@example.com",
        role: "ADMIN",
        active: true,
        isSuperAdmin: true,
        organizationId: null,
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    // The SuperAdmin switcher reads the admin endpoint, which returns an array.
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { id: "org-a", name: "Org A", plan: "BASIC", status: "ACTIVE" },
        { id: "org-b", name: "Org B", plan: "PRO", status: "ACTIVE" },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const scopedKey = ["products", { page: 1, limit: 10 }];
    queryClient.setQueryData(scopedKey, {
      data: [{ id: "product-from-org-a" }],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/admin/organizations");
    });

    // Both the rail and the drawer mount a switcher; drive the rail's.
    const rail = within(screen.getByTestId("sidebar-user-rail"));
    await userEvent.click(
      await rail.findByRole("button", { name: "Seleccionar organización" })
    );
    await userEvent.click(await screen.findByRole("button", { name: /Org A/ }));

    // A scope change must REMOVE the previous scope's data rather than mark it
    // stale: invalidation leaves those rows readable while the refetch resolves,
    // so the previously selected organization would stay on screen.
    await waitFor(() => {
      expect(queryClient.getQueryData(scopedKey)).toBeUndefined();
    });
  });

  it("honours the POS cart veto in both SuperAdmin organization switchers", async () => {
    // A previous test can leave a selected scope behind; this case proves the
    // veto keeps storage empty, so start from a clean scope.
    localStorage.removeItem(SELECTED_ORGANIZATION_KEY);
    useAuthMock.mockReturnValue({
      user: {
        id: "admin-1",
        email: "admin@example.com",
        role: "ADMIN",
        active: true,
        isSuperAdmin: true,
        organizationId: null,
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { id: "org-a", name: "Org A", plan: "BASIC", status: "ACTIVE" },
        { id: "org-b", name: "Org B", plan: "PRO", status: "ACTIVE" },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const scopedKey = ["products", { page: 1, limit: 10 }];
    queryClient.setQueryData(scopedKey, { data: [{ id: "product-from-org-a" }] });

    render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/admin/organizations");
    });

    const rail = within(screen.getByTestId("sidebar-user-rail"));
    const drawer = within(screen.getByTestId("sidebar-user"));
    const release = guardOrganizationScopeChange(() => false);
    try {
      await userEvent.click(
        await rail.findByRole("button", { name: "Seleccionar organización" })
      );
      await userEvent.click(await screen.findByRole("button", { name: /Org A/ }));

      expect(safeGetItem(SELECTED_ORGANIZATION_KEY)).toBeNull();
      expect(
        rail.getByRole("button", { name: "Seleccionar organización" })
      ).toHaveTextContent("Todas las organizaciones");
      expect(queryClient.getQueryData(scopedKey)).toBeDefined();

      await userEvent.click(
        await drawer.findByRole("button", { name: "Seleccionar organización" })
      );
      await userEvent.click(await screen.findByRole("button", { name: /Org A/ }));

      expect(safeGetItem(SELECTED_ORGANIZATION_KEY)).toBeNull();
      expect(
        drawer.getByRole("button", { name: "Seleccionar organización" })
      ).toHaveTextContent("Todas las organizaciones");
      expect(queryClient.getQueryData(scopedKey)).toBeDefined();
    } finally {
      release();
    }

    await userEvent.click(
      await drawer.findByRole("button", { name: "Seleccionar organización" })
    );
    await userEvent.click(await screen.findByRole("button", { name: /Org B/ }));

    await waitFor(() => {
      expect(safeGetItem(SELECTED_ORGANIZATION_KEY)).toBe("org-b");
    });
    expect(queryClient.getQueryData(scopedKey)).toBeUndefined();
    expect(
      drawer.getByRole("button", { name: "Seleccionar organización" })
    ).toHaveTextContent("Org B");
  });

  it("keeps a stale organization picker on the session's real scope without resetting its data", async () => {
    // The shared cookie/session can move to another organization from another
    // tab while this one is mounted, so the picker is a view of the stored
    // scope instead of a copy taken at mount.
    localStorage.removeItem(SELECTED_ORGANIZATION_KEY);
    useAuthMock.mockReturnValue({
      user: {
        id: "admin-1",
        email: "admin@example.com",
        role: "ADMIN",
        active: true,
        isSuperAdmin: true,
        organizationId: null,
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { id: "org-a", name: "Org A", plan: "BASIC", status: "ACTIVE" },
        { id: "org-b", name: "Org B", plan: "PRO", status: "ACTIVE" },
      ],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const scopedKey = ["products", { page: 1, limit: 10 }];
    queryClient.setQueryData(scopedKey, { data: [{ id: "product-from-org-a" }] });

    render(
      <QueryClientProvider client={queryClient}>
        <Sidebar />
      </QueryClientProvider>
    );
    const rail = within(screen.getByTestId("sidebar-user-rail"));
    try {
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith("/admin/organizations");
      });
      expect(
        await rail.findByRole("button", { name: "Seleccionar organización" })
      ).toHaveTextContent("Todas las organizaciones");

      // Another tab switched the session to Org A.
      act(() => {
        safeSetItem(SELECTED_ORGANIZATION_KEY, "org-a");
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: SELECTED_ORGANIZATION_KEY,
            oldValue: null,
            newValue: "org-a",
          })
        );
      });

      await waitFor(() => {
        expect(
          rail.getByRole("button", { name: "Seleccionar organización" })
        ).toHaveTextContent("Org A");
      });

      // Selecting the organization the session is already in is not a change.
      await userEvent.click(
        rail.getByRole("button", { name: "Seleccionar organización" })
      );
      await userEvent.click(await screen.findByRole("button", { name: /Org A/ }));

      expect(safeGetItem(SELECTED_ORGANIZATION_KEY)).toBe("org-a");
      expect(queryClient.getQueryData(scopedKey)).toEqual({
        data: [{ id: "product-from-org-a" }],
      });
      expect(
        rail.getByRole("button", { name: "Seleccionar organización" })
      ).toHaveTextContent("Org A");
    } finally {
      localStorage.removeItem(SELECTED_ORGANIZATION_KEY);
      queryClient.clear();
    }
  });

  it("drops a mounted page's rows when the organization scope changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const scopedKey = ["products", { page: 1, limit: 10 }];
    queryClient.setQueryData(scopedKey, {
      data: [{ id: "product-from-org-a" }],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ScopedRowsProbe />
      </QueryClientProvider>
    );

    // The probe holds an ACTIVE observer on the scoped key, which is the case an
    // assertion about the cache alone cannot reach.
    expect(await screen.findByTestId("scoped-rows")).toHaveTextContent(
      "product-from-org-a"
    );

    await act(async () => {
      applyOrganizationScope(queryClient, "org-a");
    });

    // Emptying the cache is NOT enough: removeQueries/clear leaves a mounted
    // observer holding its last result and requests no refetch at all, so the
    // previous scope's rows can stay on screen indefinitely. Only a reset drops
    // the displayed state AND refetches the active queries.
    await waitFor(() => {
      expect(screen.getByTestId("scoped-rows")).not.toHaveTextContent(
        "product-from-org-a"
      );
    });
  });

  it("stacks the three sidebar blocks in the approved order", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    // Document order is the contract: brand -> navigation -> account.
    const blocks = [
      screen.getByTestId("sidebar-brand"),
      screen.getByTestId("sidebar-nav"),
      screen.getByTestId("sidebar-user"),
    ];

    for (let i = 0; i < blocks.length - 1; i++) {
      expect(
        blocks[i].compareDocumentPosition(blocks[i + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }

    // The account block carries the user, and nothing else follows it.
    expect(blocks[2].nextElementSibling).toBeNull();
  });

  it("integrates the date and time inside the account block", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    const account = screen.getByTestId("sidebar-user");
    const clock = screen.getByTestId("sidebar-clock");

    // One block, not two: the clock is a child of the account block.
    expect(account.contains(clock)).toBe(true);
    expect(clock.tagName).toBe("TIME");
    expect(clock).toHaveAttribute("dateTime");
    expect(clock).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(clock).not.toHaveClass("font-mono");
    expect(account).toHaveTextContent("Ana Perez");
  });

  it("keeps the server markup free of the time and reserves its line so mounting does not shift the footer", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Sidebar />
      </QueryClientProvider>,
    );

    // The clock depends on the viewer's clock, so it must not reach the SSR HTML.
    expect(markup).not.toContain('data-testid="sidebar-clock"');
    expect(markup).toMatch(/data-testid="sidebar-clock-slot" class="[^"]*\bh-4\b/);
  });

  it("shows the current minute once mounted and advances it every minute", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
      render(<Sidebar />, { wrapper });

      expect(screen.getByTestId("sidebar-clock")).toHaveTextContent("9:00");

      // Fake timers move the clock with the interval, so one minute later reads 9:01.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(screen.getByTestId("sidebar-clock")).toHaveTextContent("9:01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the identity as plain text with the role below the name, no card or chip", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    const account = screen.getByTestId("sidebar-user");
    expect(screen.getByText("Ana Perez")).toHaveClass("text-sm", "font-medium", "truncate");
    expect(screen.getByText("Administrador")).toHaveClass("text-xs", "text-muted-foreground");
    // Footer separator only: no bordered card, and no online presence dot.
    expect(account).toHaveClass("border-t");
    expect(account.querySelector(".bg-success")).toBeNull();
    expect(account.querySelector("[data-slot='badge'], .rounded-xl")).toBeNull();
  });

  it("puts the bell and the account menu trigger side by side in the phone drawer footer", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    // The mobile header renders its own bell in the DOM, so scope to the footer.
    const footer = within(screen.getByTestId("sidebar-user"));
    const menuTrigger = footer.getByRole("button", { name: "Opciones de cuenta" });
    const bell = footer.getByRole("button", { name: "Alertas" });

    // Bell first, then the ⋮ menu, both frameless icon buttons.
    expect(
      bell.compareDocumentPosition(menuTrigger) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(bell).toHaveClass("h-9", "w-9");
    expect(menuTrigger).toHaveClass("h-9", "w-9", "border-transparent", "bg-transparent");
  });

  it("hands the account chrome to the header and leaves only the scope control in the rail", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-user-rail")).toHaveTextContent("Org A");
    });

    const rail = screen.getByTestId("sidebar-user-rail");
    // The rail half is lg-only, and the header now owns the bell and the account.
    expect(rail.className).toContain("hidden");
    expect(rail.className).toContain("lg:block");
    expect(within(rail).queryByRole("button", { name: /Alertas/ })).not.toBeInTheDocument();
    expect(
      within(rail).queryByRole("button", { name: "Opciones de cuenta" })
    ).not.toBeInTheDocument();
    expect(within(rail).queryByTestId("sidebar-clock")).not.toBeInTheDocument();
    // What is left down there is the tenant scope, which has no other home.
    expect(within(rail).getByLabelText(/Cambiar organización/i)).toBeInTheDocument();
  });

  it("keeps the bell, the account menu and the clock for the phone drawer", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    const drawer = screen.getByTestId("sidebar-user");
    // The drawer is the account's only home below lg, so it loses nothing.
    expect(drawer.className).toContain("lg:hidden");
    expect(within(drawer).getByRole("button", { name: "Opciones de cuenta" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /Alertas/ })).toBeInTheDocument();
    expect(within(drawer).getByTestId("sidebar-clock")).toBeInTheDocument();
    expect(within(drawer).getByText("Ana Perez")).toBeInTheDocument();
  });

  it("leaves the collapsed rail with no account chrome at all", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>
    );

    // The rail starts expanded (beforeEach), so one toggle collapses it.
    await userEvent.click(await screen.findByTestId("sidebar-collapse-toggle"));

    const rail = screen.getByTestId("sidebar-user-rail");
    expect(rail.querySelector("button")).toBeNull();
    expect(rail).not.toHaveTextContent("Ana Perez");

    // The drawer keeps its footer regardless of the rail's width.
    const drawer = screen.getByTestId("sidebar-user");
    expect(within(drawer).getByRole("button", { name: "Opciones de cuenta" })).toBeInTheDocument();
  });

  it("separates Cerrar sesión from the rest of the account menu", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Opciones de cuenta" })
    );

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("keeps the account destinations inside the account menu", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Opciones de cuenta" })
    );

    expect(
      screen.getByRole("menuitem", { name: /Mi perfil/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Configuración/ })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: /Mi perfil/ }));

    expect(pushMock).toHaveBeenCalledWith("/profile");
  });

  it("hides Configuración from the account menu when the role is not allowed", async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: "user-2",
        name: "Carlos Cajero",
        role: "CASHIER",
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Opciones de cuenta" })
    );

    expect(
      screen.getByRole("menuitem", { name: /Mi perfil/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Configuración/ })
    ).not.toBeInTheDocument();
  });

  it("renders the collapse toggle button and toggles collapsed state", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>
    );

    const toggleBtn = await screen.findByTestId("sidebar-collapse-toggle");
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("aria-label", "Colapsar barra lateral");
    // The toggle draws the panel glyph, not chevrons.
    expect(toggleBtn.querySelector("svg.lucide-panel-left-close")).not.toBeNull();

    // Click to collapse
    await userEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-label", "Expandir barra lateral");
    expect(toggleBtn.querySelector("svg.lucide-panel-left-open")).not.toBeNull();
    expect(safeGetItem(SIDEBAR_COLLAPSED_KEY)).toBe("true");

    // Click to expand again
    await userEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-label", "Colapsar barra lateral");
    expect(safeGetItem(SIDEBAR_COLLAPSED_KEY)).toBe("false");
  });

  it("shows floating tooltip on link hover when sidebar is collapsed", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>
    );

    const toggleBtn = await screen.findByTestId("sidebar-collapse-toggle");
    await userEvent.click(toggleBtn);

    const dashboardLink = screen.getByRole("link", { name: "Panel" });
    await userEvent.hover(dashboardLink);

    const tooltip = await screen.findByTestId("sidebar-rail-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Panel");
  });

  // The mobile header and the drawer are the two fixed surfaces a notch and a
  // home indicator actually overlap. Class assertions are the only observable
  // in jsdom, where `env()` is 0: a regression pin, not visual proof.
  it("keeps the fixed mobile chrome clear of the notch and the home indicator", () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    const { container } = render(<Sidebar />, { wrapper });

    const header = container.querySelector("header");
    const drawer = container.querySelector("[data-sidebar-root]");

    expect(header?.className).toContain("pt-[var(--safe-top)]");
    expect(header?.className).toContain(
      "h-[calc(var(--mobile-header)+var(--safe-top))]"
    );
    // The drawer is the whole phone screen now, so it pays every inset itself
    // instead of starting below the header.
    for (const inset of [
      "pt-[var(--safe-top)]",
      "pb-[var(--safe-bottom)]",
      "pl-[var(--safe-left)]",
      "pr-[var(--safe-right)]",
    ]) {
      expect(drawer?.className).toContain(inset);
    }
  });

  it("renders the Lucky square icon and hides wordmark text when collapsed", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>
    );

    const brandBlock = await screen.findByTestId("sidebar-brand");
    const imgsBefore = brandBlock.querySelectorAll("img");
    expect(imgsBefore.length).toBe(1);
    expect(imgsBefore[0].getAttribute("src")).toContain("icon-192.png");

    const wordmark = brandBlock.querySelector("p");
    expect(wordmark).not.toHaveClass("sr-only");

    const toggleBtn = await screen.findByTestId("sidebar-collapse-toggle");
    await userEvent.click(toggleBtn);

    expect(wordmark).toHaveClass("sr-only");
  });

  // The rail's brand border and the header's border have to land on the same
  // pixel row, or the two bars read as two different heights. One token owns
  // the height; the brand row takes it and drops its own padding at lg, so the
  // 44px mark fits without growing the bar to fit the mark.
  it("puts the brand border on the header's pixel row", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>
    );

    const brand = await screen.findByTestId("sidebar-brand");
    const row = brand.querySelector<HTMLElement>(
      '[data-testid="sidebar-brand-row"]'
    )!;

    expect(row.className).toContain("lg:h-[var(--app-header-height)]");
    expect(row.className).toContain("lg:py-0");
    expect(row.className).toContain("border-b");
    // The mark keeps its full size: the row grew, the logo did not shrink.
    expect(row.querySelector("img")?.className).toContain("lg:h-11");
  });

  it("keeps the collapsed border under the logo with the toggle below it", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });
    safeSetItem(SIDEBAR_COLLAPSED_KEY, "true");

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>
    );

    const brand = await screen.findByTestId("sidebar-brand");
    const row = brand.querySelector<HTMLElement>(
      '[data-testid="sidebar-brand-row"]'
    )!;

    expect(row.className).toContain("h-[var(--app-header-height)]");
    expect(row.className).toContain("border-b");

    // The expand control sits below the border so the bordered row holds only
    // the mark, and the rail's border starts where the header's does.
    const toggle = await screen.findByTestId("sidebar-collapse-toggle");
    expect(row.contains(toggle)).toBe(false);
    expect(toggle.closest("[data-testid='sidebar-brand-row']")).toBeNull();
  });

  describe("rail scrolling", () => {
    // The rail paints no scrollbar, so overflow is signalled by edge fades and
    // the offset has to survive the session shell remounting around it.
    function mockRailBox(nav: HTMLElement, scrollHeight: number, clientHeight: number) {
      Object.defineProperty(nav, "scrollHeight", {
        value: scrollHeight,
        configurable: true,
      });
      Object.defineProperty(nav, "clientHeight", {
        value: clientHeight,
        configurable: true,
      });
    }

    beforeEach(() => {
      localStorage.removeItem(SIDEBAR_SCROLL_KEY);
    });

    it("hides the native scrollbar instead of painting the app track over the icons", () => {
      render(<Sidebar />, { wrapper });

      const nav = screen.getByTestId("sidebar-nav");
      expect(nav).toHaveClass("sidebar-scroll");
      expect(nav).not.toHaveClass("scrollbar-app");
    });

    it("restores the stored offset so entering a session never snaps the rail to the top", () => {
      safeSetItem(SIDEBAR_SCROLL_KEY, "180");

      render(<Sidebar />, { wrapper });

      expect(screen.getByTestId("sidebar-nav").scrollTop).toBe(180);
    });

    it("remembers the offset after a manual scroll", async () => {
      render(<Sidebar />, { wrapper });

      const nav = screen.getByTestId("sidebar-nav");
      mockRailBox(nav, 900, 300);
      nav.scrollTop = 240;

      fireEvent.scroll(nav);

      await waitFor(() => expect(safeGetItem(SIDEBAR_SCROLL_KEY)).toBe("240"));
    });

    it("shows the edge fades only while hidden content remains to scroll to", async () => {
      render(<Sidebar />, { wrapper });

      const nav = screen.getByTestId("sidebar-nav");
      expect(screen.getByTestId("sidebar-scroll-fade-top")).toHaveAttribute(
        "data-visible",
        "false"
      );
      expect(screen.getByTestId("sidebar-scroll-fade-bottom")).toHaveAttribute(
        "data-visible",
        "false"
      );

      mockRailBox(nav, 900, 300);
      nav.scrollTop = 240;
      fireEvent.scroll(nav);

      await waitFor(() =>
        expect(screen.getByTestId("sidebar-scroll-fade-top")).toHaveAttribute(
          "data-visible",
          "true"
        )
      );
      expect(screen.getByTestId("sidebar-scroll-fade-bottom")).toHaveAttribute(
        "data-visible",
        "true"
      );

      nav.scrollTop = 600;
      fireEvent.scroll(nav);

      await waitFor(() =>
        expect(screen.getByTestId("sidebar-scroll-fade-bottom")).toHaveAttribute(
          "data-visible",
          "false"
        )
      );
    });
  });
});

// S1.2: the drawer is the "everything else" surface. The four sections the tab
// bar already offers leave it below lg, and a group whose whole list is tabs
// loses its heading too. jsdom resolves no media query, so the responsive
// contract is pinned by the classes: `hidden lg:flex` on a row, `hidden lg:block`
// on a group, and a plain `flex` on a row that stays.
describe("drawer offers only what the tab bar does not", () => {
  function renderAs(role: string) {
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
        name: "Ana Perez",
        role,
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [] },
    });
    return render(<Sidebar />, { wrapper });
  }

  it("drops every section an owner already has as a tab", () => {
    renderAs("OWNER");

    for (const name of ["Panel", "POS", "Ventas", "Inventario"]) {
      const row = screen.getByRole("link", { name });
      expect(row).toHaveClass("hidden");
      expect(row).toHaveClass("lg:flex");
      // tailwind-merge must have dropped the bare `flex`, or display:none loses.
      expect(row).not.toHaveClass("flex");
    }

    const kept = screen.getByRole("link", { name: "Clientes" });
    expect(kept).toHaveClass("flex");
    expect(kept).not.toHaveClass("hidden");
  });

  it("keeps the rows a cashier's tabs do not cover", () => {
    renderAs("CASHIER");

    for (const name of ["POS", "Ventas", "Inventario"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("hidden");
    }
    // Clientes and Préstamos have no tab, so their rows stay in the drawer.
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveClass("flex");
    expect(screen.getByRole("link", { name: "Préstamos" })).toHaveClass("flex");
    // Panel is not a cashier section at all: the role filter, not the tab rule.
    expect(screen.queryByRole("link", { name: "Panel" })).toBeNull();
  });

  it("removes a group heading whose whole list is tabs", () => {
    const { container } = renderAs("CASHIER");

    const inventoryGroup = container.querySelector('[data-nav-group="Inventario"]');
    expect(inventoryGroup?.className).toContain("hidden");
    expect(inventoryGroup?.className).toContain("lg:block");

    const operationsGroup = container.querySelector('[data-nav-group="Operación"]');
    expect(operationsGroup?.className).not.toContain("hidden");
  });

  it("removes Operación for an inventory user, whose only row there is a tab", () => {
    const { container } = renderAs("INVENTORY_USER");

    const operationsGroup = container.querySelector('[data-nav-group="Operación"]');
    expect(operationsGroup?.className).toContain("hidden");
    expect(operationsGroup?.className).toContain("lg:block");

    const inventoryGroup = container.querySelector('[data-nav-group="Inventario"]');
    expect(inventoryGroup?.className).not.toContain("hidden");
  });
});

// The header owns the bell above `lg`, so the rail drops its copy entirely and
// the drawer keeps the one a phone can reach (the top bar has its own).
describe("one bell per surface (mobile shell)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeSetItem(SIDEBAR_COLLAPSED_KEY, "false");
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
        name: "Ana Perez",
        role: "ADMIN",
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
  });

  it("keeps the bell in the phone drawer and never in the rail", () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    // The drawer carries it below lg…
    const drawer = screen.getByTestId("sidebar-user");
    expect(drawer.className).toContain("lg:hidden");
    expect(within(drawer).getByRole("button", { name: /Alertas/ })).toBeInTheDocument();

    // …the top bar keeps its own…
    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: /Alertas/ }),
    ).toBeInTheDocument();

    // …and the rail, which the desktop header now serves, has none.
    expect(
      within(screen.getByTestId("sidebar-user-rail")).queryByRole("button", {
        name: /Alertas/,
      }),
    ).toBeNull();
  });
});

// A drawer that only covered part of the screen left a dimmed half page behind
// it, which reads as a website menu. On a phone it is now a "Más" screen: the
// whole viewport, its own close control, and the tab bar stays under it.
describe("the mobile drawer is the phone's whole screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeSetItem(SIDEBAR_COLLAPSED_KEY, "false");
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
        name: "Ana Perez",
        role: "ADMIN",
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
  });

  afterEach(closeMobileDrawer);

  function drawerElement(container: HTMLElement) {
    return container.querySelector<HTMLElement>("[data-sidebar-root]")!;
  }

  it("covers the viewport and keeps the rail's own geometry at lg", () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    const { container } = render(<Sidebar />, { wrapper });
    const drawer = drawerElement(container);

    expect(drawer.className).toContain("inset-0");
    expect(drawer.className).toContain("w-full");
    expect(drawer.className).toContain("h-dvh");
    // The rail is still a column of its own width that never hides.
    expect(drawer.className).toContain("lg:w-[256px]");
    expect(drawer.className).toContain("lg:h-screen");
    expect(drawer.className).toContain("lg:translate-x-0");
    expect(drawer.className).toContain("lg:opacity-100");
    expect(drawer.className).toContain("lg:pointer-events-auto");
  });

  it("keeps the collapsed rail at the 72px icon column", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </QueryClientProvider>,
    );
    const drawer = drawerElement(container);

    await userEvent.click(await screen.findByTestId("sidebar-collapse-toggle"));
    expect(drawer.className).toContain("lg:w-[72px]");

    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    expect(drawer.className).toContain("lg:w-[256px]");
  });

  it("enters with a short travel plus a fade, and honours reduced motion", () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    const { container } = render(<Sidebar />, { wrapper });
    const drawer = drawerElement(container);

    // A full-screen wipe is not subtle: a few pixels and an opacity change read
    // as a screen change without sliding the whole app away.
    expect(drawer.className).toContain("-translate-x-3");
    expect(drawer.className).toContain("opacity-0");
    expect(drawer.className).not.toContain("-translate-x-full");
    expect(drawer.className).toContain("motion-reduce:transition-none");

    act(() => openMobileDrawer());

    expect(drawer).toHaveAttribute("data-state", "open");
    expect(drawer.className).toContain("translate-x-0");
    expect(drawer.className).toContain("opacity-100");
    expect(drawer.className).not.toContain("pointer-events-none");
  });

  it("leaves no dimmed overlay behind it", () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    act(() => openMobileDrawer());

    expect(document.querySelectorAll('[class*="bg-black/40"]')).toHaveLength(0);
  });

  it("scrolls its own navigation and keeps 44px rows for the thumb", () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    const nav = screen.getByTestId("sidebar-nav");
    expect(nav.className).toContain("overflow-y-auto");
    // Nothing sits under the drawer any more, so the old tab-bar reserve is gone.
    expect(nav.className).not.toContain("calc(5rem");

    expect(screen.getByRole("link", { name: "Clientes" }).className).toContain("h-11");

    const close = screen.getByRole("button", { name: "Cerrar menú" });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
  });
});

// S11: the alerts history is one more destination of the account menu the user
// already opens for Mi perfil and Configuración, so it reaches the phone too —
// the drawer renders the same footer. The audience is the /alerts route gate:
// ADMIN and INVENTORY_USER, with OWNER and SUPER_ADMIN inheriting ADMIN.
describe("alerts history in the account menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeSetItem(SIDEBAR_COLLAPSED_KEY, "false");
  });

  afterEach(closeMobileDrawer);

  function renderAs(role: string) {
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
        name: "Ana Perez",
        role,
        active: true,
        organizationId: "org-a",
      },
      logout: vi.fn(),
      switchOrganization: switchOrganizationMock,
    });
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });
    return render(<Sidebar />, { wrapper });
  }

  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["INVENTORY_USER", true],
    ["SUPER_ADMIN", true],
    ["CASHIER", false],
    ["MEMBER", false],
  ])(
    "shows the alerts history to %s only when the role may open /alerts",
    async (role, permitted) => {
      renderAs(role);

      await waitFor(() => expect(api.get).toHaveBeenCalled());

      await userEvent.click(
        screen.getByRole("button", { name: "Opciones de cuenta" }),
      );

      const item = screen.queryByRole("menuitem", {
        name: /Historial de alertas/,
      });
      if (permitted) expect(item).toBeInTheDocument();
      else expect(item).not.toBeInTheDocument();
    },
  );

  it("sits right after Mi perfil in the menu", async () => {
    renderAs("ADMIN");

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await userEvent.click(
      screen.getByRole("button", { name: "Opciones de cuenta" }),
    );

    const labels = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    expect(labels.slice(0, 3)).toEqual([
      "Mi perfil",
      "Historial de alertas",
      "Configuración",
    ]);
  });

  it("opens the history from the phone drawer's account menu and closes it", async () => {
    const { container } = renderAs("ADMIN");
    const drawer = container.querySelector<HTMLElement>("[data-sidebar-root]")!;

    act(() => openMobileDrawer());
    expect(drawer).toHaveAttribute("data-state", "open");

    // The phone's account menu is the drawer footer, the same one the rail paints.
    await userEvent.click(
      within(drawer).getByRole("button", { name: "Opciones de cuenta" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Historial de alertas/ }),
    );

    expect(pushMock).toHaveBeenCalledWith("/alerts");
    expect(drawer).toHaveAttribute("data-state", "closed");
  });
});
