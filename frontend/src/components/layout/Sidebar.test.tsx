import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Sidebar, applyOrganizationScope } from "./Sidebar";
import { SidebarProvider, SIDEBAR_COLLAPSED_KEY } from "@/contexts/SidebarContext";
import { safeGetItem, safeSetItem } from "@/lib/utils";
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

    await waitFor(() => {
      expect(screen.getByText("Org A")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText(/Cambiar organizacion/i)
    ).toBeInTheDocument();
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
      screen.queryByLabelText(/Cambiar organizacion/i)
    ).not.toBeInTheDocument();
  });

  it("shows the Salidas nav item for ADMIN users", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Org A")).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: "Salidas" });
    expect(link).toHaveAttribute("href", "/expenses");
  });

  it("uses the approved operational order and keeps users out of the main sidebar", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => expect(screen.getByText("Org A")).toBeInTheDocument());

    const links = screen.getAllByRole("link").map((link) => link.textContent?.trim());
    expect(links).toEqual([
      "Dashboard",
      "POS",
      "Ventas",
      "Clientes",
      "Préstamos",
      "Inventario",
      "Categorías",
      "Proveedores",
      "Compras",
      "Salidas",
      "Reportes",
      "Tareas",
      "Mi perfil",
      "Configuración",
    ]);
    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
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

    await userEvent.click(
      await screen.findByRole("button", { name: "Seleccionar organizacion" })
    );
    await userEvent.click(await screen.findByRole("button", { name: /Org A/ }));

    // A scope change must REMOVE the previous scope's data rather than mark it
    // stale: invalidation leaves those rows readable while the refetch resolves,
    // so the previously selected organization would stay on screen.
    await waitFor(() => {
      expect(queryClient.getQueryData(scopedKey)).toBeUndefined();
    });
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

  it("stacks the four sidebar blocks in the approved order", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    // Document order is the contract: brand -> date/time -> navigation -> user.
    const blocks = [
      screen.getByTestId("sidebar-brand"),
      screen.getByTestId("sidebar-clock"),
      screen.getByTestId("sidebar-nav"),
      screen.getByTestId("sidebar-user"),
    ];

    for (let i = 0; i < blocks.length - 1; i++) {
      expect(
        blocks[i].compareDocumentPosition(blocks[i + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("renders the es-CO date and time as its own block below the brand", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    render(<Sidebar />, { wrapper });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/auth/organizations");
    });

    const clock = screen.getByTestId("sidebar-clock");
    expect(clock).toHaveTextContent(/\d{4}/);
    expect(clock).toHaveTextContent(/\d{1,2}:\d{2}/);
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

    // Click to collapse
    await userEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-label", "Expandir barra lateral");
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

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    await userEvent.hover(dashboardLink);

    const tooltip = await screen.findByTestId("sidebar-rail-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Dashboard");
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
});

