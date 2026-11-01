import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrganizationsPage from "./page";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const { mockUseOrganizations, mockCreateOrganization, mockUpdateStatus, mockUpdatePlan } =
  vi.hoisted(() => ({
    mockUseOrganizations: vi.fn(),
    mockCreateOrganization: vi.fn(),
    mockUpdateStatus: vi.fn(),
    mockUpdatePlan: vi.fn(),
  }));

vi.mock("@/hooks/useAdmin", () => ({
  useOrganizations: () => mockUseOrganizations(),
  useCreateOrganization: () => mockCreateOrganization(),
  useUpdateOrganizationStatus: () => mockUpdateStatus(),
  useUpdateOrganizationPlan: () => mockUpdatePlan(),
}));

const mockOrg = {
  id: "org-1",
  name: "Cafetería Demo",
  slug: "cafeteria-demo",
  status: "ACTIVE",
  plan: "PRO",
  userCount: 7,
  trialEndsAt: null,
  billingStatus: null,
  taxId: null,
  phone: null,
  address: null,
  active: true,
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
};

function setupMocks() {
  mockUseOrganizations.mockReturnValue({
    data: [mockOrg],
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

describe("OrganizationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("renders the organization with Spanish status and plan labels", () => {
    render(<OrganizationsPage />);

    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.getByText("cafeteria-demo")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("opens the edit dialog and saves the changed status", async () => {
    const user = userEvent.setup();
    const mutateStatus = vi.fn();
    mockUpdateStatus.mockReturnValue({ mutate: mutateStatus, isPending: false });

    render(<OrganizationsPage />);

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

  it("navigates to the organization detail from the row menu", async () => {
    const user = userEvent.setup();

    render(<OrganizationsPage />);

    await user.click(screen.getByRole("button", { name: "Acciones de Cafetería Demo" }));
    await user.click(screen.getByText("Ver detalle"));

    expect(pushMock).toHaveBeenCalledWith("/admin/organizations/org-1");
  });
});
