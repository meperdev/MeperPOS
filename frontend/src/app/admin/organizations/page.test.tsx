import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizationsPage from "./page";

const pushMock = vi.fn();
const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsRef.current,
}));

const {
  mockUseOrganizations,
  mockCreateOrganization,
  mockUpdateStatus,
  mockUpdatePlan,
  applyOrganizationScopeMock,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  mockUseOrganizations: vi.fn(),
  mockCreateOrganization: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockUpdatePlan: vi.fn(),
  applyOrganizationScopeMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useOrganizations: () => mockUseOrganizations(),
  useCreateOrganization: () => mockCreateOrganization(),
  useUpdateOrganizationStatus: () => mockUpdateStatus(),
  useUpdateOrganizationPlan: () => mockUpdatePlan(),
}));

vi.mock("@/lib/organizationScope", () => ({
  applyOrganizationScope: (...args: unknown[]) => applyOrganizationScopeMock(...args),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

type MockOrg = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  billingStatus: string | null;
  taxId: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
};

function org(overrides: Partial<MockOrg> = {}): MockOrg {
  return {
    id: "org-1",
    name: "Cafetería Demo",
    slug: "cafeteria-demo",
    status: "ACTIVE",
    plan: "PRO",
    trialEndsAt: null,
    billingStatus: "PAID",
    taxId: null,
    phone: null,
    address: null,
    active: true,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    userCount: 7,
    ...overrides,
  };
}

function setupMocks(organizations: MockOrg[] = [org()]) {
  mockUseOrganizations.mockReturnValue({
    data: organizations,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockCreateOrganization.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
  });
  mockUpdateStatus.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUpdatePlan.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationsPage />
    </QueryClientProvider>,
  );
}

describe("OrganizationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams();
    setupMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders the organization with Spanish status and plan labels", () => {
    renderPage();

    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.getByText("cafeteria-demo")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("filters by name ignoring accents", async () => {
    const user = userEvent.setup();
    setupMocks([
      org(),
      org({ id: "org-2", name: "Tienda Norte", slug: "tienda-norte" }),
    ]);
    renderPage();

    await user.type(screen.getByRole("searchbox"), "cafeteria");

    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.queryByText("Tienda Norte")).not.toBeInTheDocument();
  });

  it("starts filtered from the status query parameter", () => {
    searchParamsRef.current = new URLSearchParams("status=SUSPENDED");
    setupMocks([
      org(),
      org({ id: "org-2", name: "Tienda Norte", slug: "tienda-norte", status: "SUSPENDED" }),
    ]);
    renderPage();

    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.queryByText("Cafetería Demo")).not.toBeInTheDocument();
  });

  it("shows the trial and billing state of a tenant", () => {
    setupMocks([
      org({
        trialEndsAt: "2026-01-01T00:00:00.000Z",
        billingStatus: "OVERDUE",
      }),
    ]);
    renderPage();

    expect(screen.getByText("Vencido")).toBeInTheDocument();
    expect(screen.getByText("En mora")).toBeInTheDocument();
  });

  it("paginates the list", async () => {
    const user = userEvent.setup();
    const organizations = Array.from({ length: 11 }, (_, index) =>
      org({
        id: `org-${index + 1}`,
        name: `Org ${index + 1}`,
        slug: `org-${index + 1}`,
        createdAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    setupMocks(organizations);
    renderPage();

    expect(screen.getByText("Org 11")).toBeInTheDocument();
    expect(screen.queryByText("Org 1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(screen.getByText("Org 1")).toBeInTheDocument();
  });

  it("opens the edit dialog and saves the changed status", async () => {
    const user = userEvent.setup();
    const mutateStatus = vi.fn();
    mockUpdateStatus.mockReturnValue({ mutate: mutateStatus, isPending: false });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Acciones de Cafetería Demo" }));
    await user.click(screen.getByText("Editar estado y plan"));

    expect(screen.getByText("Editar organización")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activa" }));
    await user.click(screen.getByText("Suspendida"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mutateStatus).toHaveBeenCalledWith({
        id: "org-1",
        status: "SUSPENDED",
      }),
    );
  });

  it("opens the dashboard scoped to the chosen organization", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Acciones de Cafetería Demo" }));
    await user.click(screen.getByText("Abrir como organización"));

    expect(applyOrganizationScopeMock).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("copies the slug to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // userEvent installs its own clipboard stub during setup; ours must win.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Acciones de Cafetería Demo" }));
    await user.click(screen.getByText("Copiar slug"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("cafeteria-demo"));
    expect(toastSuccess).toHaveBeenCalledWith("Slug copiado");
  });

  it("navigates to the organization detail from the row menu", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Acciones de Cafetería Demo" }));
    await user.click(screen.getByText("Ver detalle"));

    expect(pushMock).toHaveBeenCalledWith("/admin/organizations/org-1");
  });
});
