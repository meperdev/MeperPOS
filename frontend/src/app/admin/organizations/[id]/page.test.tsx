import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizationDetailPage from "./page";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const {
  mockUseOrganization,
  mockUseUpdateOrganizationStatus,
  mockUseUpdateOrganizationPlan,
  mockUseUpdateOrganization,
  mockUseAddOrganizationMember,
  mockUseUpdateMemberRole,
  mockUseRemoveOrganizationMember,
  mockUseDeleteOrganization,
} = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockUseUpdateOrganizationStatus: vi.fn(),
  mockUseUpdateOrganizationPlan: vi.fn(),
  mockUseUpdateOrganization: vi.fn(),
  mockUseAddOrganizationMember: vi.fn(),
  mockUseUpdateMemberRole: vi.fn(),
  mockUseRemoveOrganizationMember: vi.fn(),
  mockUseDeleteOrganization: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useOrganization: (id: string) => mockUseOrganization(id),
  useUpdateOrganizationStatus: () => mockUseUpdateOrganizationStatus(),
  useUpdateOrganizationPlan: () => mockUseUpdateOrganizationPlan(),
  useUpdateOrganization: () => mockUseUpdateOrganization(),
  useAddOrganizationMember: () => mockUseAddOrganizationMember(),
  useUpdateMemberRole: () => mockUseUpdateMemberRole(),
  useRemoveOrganizationMember: () => mockUseRemoveOrganizationMember(),
  useDeleteOrganization: () => mockUseDeleteOrganization(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockOrg = {
  id: "org-1",
  name: "Tienda Principal",
  slug: "tienda-principal",
  status: "ACTIVE",
  plan: "PRO",
  trialEndsAt: null,
  billingStatus: null,
  taxId: "900123456-7",
  phone: "+57 300 123 4567",
  address: "Calle 123 #45-67, Bogot\u00e1",
  active: true,
  createdAt: "2025-01-15T00:00:00.000Z",
  updatedAt: "2025-06-01T00:00:00.000Z",
  users: [
    {
      id: "ou-1",
      role: "ADMIN",
      isPrimaryOwner: true,
      joinedAt: "2025-01-15T00:00:00.000Z",
      user: {
        id: "u-1",
        name: "Juan Perez",
        email: "juan@example.com",
        active: true,
      },
    },
    {
      id: "ou-2",
      role: "CASHIER",
      isPrimaryOwner: false,
      joinedAt: "2025-03-01T00:00:00.000Z",
      user: {
        id: "u-2",
        name: "Maria Lopez",
        email: "maria@example.com",
        active: true,
      },
    },
  ],
};

const resolvedParams = Promise.resolve({ id: "org-1" });

function setupDefaultMocks() {
  mockUseUpdateOrganizationStatus.mockReturnValue({
    mutate: vi.fn(),
  });
  mockUseUpdateOrganizationPlan.mockReturnValue({
    mutate: vi.fn(),
  });
  mockUseUpdateOrganization.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseDeleteOrganization.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseAddOrganizationMember.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseUpdateMemberRole.mockReturnValue({
    mutate: vi.fn(),
  });
  mockUseRemoveOrganizationMember.mockReturnValue({
    mutate: vi.fn(),
  });
}

describe("OrganizationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("with organization data", () => {
    beforeEach(async () => {
      mockUseOrganization.mockReturnValue({
        data: mockOrg,
        isLoading: false,
      });
      setupDefaultMocks();
      await act(async () => {
        render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
      });
    });

    it("renders organization name, slug, and status badge", () => {
      expect(screen.getByDisplayValue("Tienda Principal")).toBeInTheDocument();
      expect(screen.getByDisplayValue("tienda-principal")).toBeInTheDocument();

      const badges = screen.getAllByText("Activa");
      expect(badges.length).toBeGreaterThan(0);
    });

    it("renders plan information", () => {
      expect(screen.getByText("PRO")).toBeInTheDocument();
    });

    it("renders taxId when available", () => {
      expect(screen.getByDisplayValue("900123456-7")).toBeInTheDocument();
    });

    it("renders phone when available", () => {
      expect(screen.getByDisplayValue("+57 300 123 4567")).toBeInTheDocument();
    });

    it("renders address when available", () => {
      expect(
        screen.getByDisplayValue("Calle 123 #45-67, Bogot\u00e1")
      ).toBeInTheDocument();
    });

    it("renders the member list table", () => {
      expect(screen.getByText("Juan Perez")).toBeInTheDocument();
      expect(screen.getByText("juan@example.com")).toBeInTheDocument();
      expect(screen.getByText("Maria Lopez")).toBeInTheDocument();
      expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    });

    it("renders member roles in the table", () => {
      // Role selects use Spanish labels from roleOptions
      const adminOccurrences = screen.getAllByText("Administrador");
      expect(adminOccurrences.length).toBeGreaterThanOrEqual(1);
      const cashierOccurrences = screen.getAllByText("Cajero");
      expect(cashierOccurrences.length).toBeGreaterThanOrEqual(1);
    });

    it("renders primary owner indicator", () => {
      const siBadge = screen.getByText("S\u00ed");
      expect(siBadge).toBeInTheDocument();
    });

    it("renders the status change dropdown", () => {
      expect(screen.getByText("Cambiar estado")).toBeInTheDocument();
    });

    it("renders the plan change dropdown", () => {
      expect(screen.getByText("Cambiar plan")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        data: undefined,
        isLoading: true,
      });
      setupDefaultMocks();
      render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
    });

    it("renders the loading state with the organization message", () => {
      // Real LoadingState renders an animate-pulse container, not a spinner.
      const pulse = document.querySelector(".animate-pulse");
      expect(pulse).toBeInTheDocument();
      expect(
        screen.getByText("Cargando organizaci\u00f3n...")
      ).toBeInTheDocument();
    });
  });

  describe("not found state", () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        data: null,
        isLoading: false,
      });
      setupDefaultMocks();
      render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
    });

    it("renders 'not found' message when organization is null", () => {
      expect(
        screen.getByText("Organizaci\u00f3n no encontrada")
      ).toBeInTheDocument();
    });

    it("renders a back button to the organizations list", () => {
      const backButton = screen.getByText("Volver");
      expect(backButton).toBeInTheDocument();
    });
  });

  describe("organization without members", () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        data: { ...mockOrg, users: [] },
        isLoading: false,
      });
      setupDefaultMocks();
      render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
    });

    it("renders empty members message", () => {
      expect(
        screen.getByText("No hay usuarios en esta organizaci\u00f3n")
      ).toBeInTheDocument();
    });
  });

  describe("organization without optional fields", () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        data: {
          ...mockOrg,
          taxId: null,
          phone: null,
          address: null,
          billingStatus: null,
          trialEndsAt: null,
        },
        isLoading: false,
      });
      setupDefaultMocks();
      render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
    });

    it("renders placeholder for missing fields", () => {
      const dashes = screen.getAllByText("\u2014");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("with trial end date", () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        data: {
          ...mockOrg,
          trialEndsAt: "2025-02-15T00:00:00.000Z",
        },
        isLoading: false,
      });
      setupDefaultMocks();
      render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
    });

    it("renders trial end date section", () => {
      expect(
        screen.getByText(/Trial finaliza:/)
      ).toBeInTheDocument();
    });
  });

  describe("section headings", () => {
    beforeEach(() => {
      mockUseOrganization.mockReturnValue({
        data: mockOrg,
        isLoading: false,
      });
      setupDefaultMocks();
      render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
    });

    it("renders Informaci\u00f3n general heading", () => {
      expect(
        screen.getByText("Informaci\u00f3n general")
      ).toBeInTheDocument();
    });

    it("renders Acciones heading", () => {
      const accionesHeading = screen
        .getAllByText("Acciones")
        .find((el) => el.tagName === "H3");
      expect(accionesHeading).toBeInTheDocument();
    });

    it("renders Usuarios de la organizacion heading", () => {
      expect(
        screen.getByText("Usuarios de la organizaci\u00f3n")
      ).toBeInTheDocument();
    });
  });

  describe("edit organization form", () => {
    beforeEach(async () => {
      mockUseOrganization.mockReturnValue({
        data: mockOrg,
        isLoading: false,
      });
      setupDefaultMocks();
      await act(async () => {
        render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
      });
    });

    it("renders editable input fields for organization details", () => {
      const nameInput = screen.getByDisplayValue("Tienda Principal");
      expect(nameInput).toBeInTheDocument();
      expect(nameInput.tagName).toBe("INPUT");

      const slugInput = screen.getByDisplayValue("tienda-principal");
      expect(slugInput).toBeInTheDocument();

      const taxIdInput = screen.getByDisplayValue("900123456-7");
      expect(taxIdInput).toBeInTheDocument();
    });

    it("renders a save button for editing organization", () => {
      const saveButton = screen.getByText("Guardar cambios");
      expect(saveButton).toBeInTheDocument();
    });
  });

  describe("member management", () => {
    beforeEach(async () => {
      mockUseOrganization.mockReturnValue({
        data: mockOrg,
        isLoading: false,
      });
      setupDefaultMocks();
      await act(async () => {
        render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
      });
    });

    it("renders role dropdown for each member", () => {
      // BentoSelect renders each role as a trigger <button> showing the
      // selected role label (no native combobox). Assert those are present.
      const roleButtons = screen
        .getAllByRole("button")
        .map((button) => button.textContent?.trim())
        .filter((text) => text === "Administrador" || text === "Cajero");
      expect(roleButtons.length).toBeGreaterThanOrEqual(1);
    });

    it("renders remove button for non-owner members", () => {
      expect(
        screen.getByRole("button", { name: "Acciones de Maria Lopez" })
      ).toBeInTheDocument();
    });

    it("renders an add member button", () => {
      const addButton = screen.getByText("A\u00f1adir miembro");
      expect(addButton).toBeInTheDocument();
    });
  });

  describe("delete organization", () => {
    beforeEach(async () => {
      mockUseOrganization.mockReturnValue({
        data: mockOrg,
        isLoading: false,
      });
      setupDefaultMocks();
      await act(async () => {
        render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
      });
    });

    it("renders a delete organization button", () => {
      const deleteButton = screen.getByText("Eliminar organizaci\u00f3n");
      expect(deleteButton).toBeInTheDocument();
    });
  });

  describe("add member modal", () => {
    beforeEach(async () => {
      mockUseOrganization.mockReturnValue({
        data: mockOrg,
        isLoading: false,
      });
      setupDefaultMocks();
      await act(async () => {
        render(<OrganizationDetailPage params={resolvedParams} />, { wrapper });
      });
    });

    it("opens add member modal when button is clicked", async () => {
      const addButton = screen.getByText("A\u00f1adir miembro");
      await userEvent.click(addButton);

      // Modal should appear with email input
      const emailInput = screen.getByPlaceholderText("correo@ejemplo.com");
      expect(emailInput).toBeInTheDocument();
    });
  });
});
