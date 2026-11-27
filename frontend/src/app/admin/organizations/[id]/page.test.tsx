import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, within, waitFor } from "@testing-library/react";
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
  removeMemberMutateAsync,
} = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
  mockUseUpdateOrganizationStatus: vi.fn(),
  mockUseUpdateOrganizationPlan: vi.fn(),
  mockUseUpdateOrganization: vi.fn(),
  mockUseAddOrganizationMember: vi.fn(),
  mockUseUpdateMemberRole: vi.fn(),
  mockUseRemoveOrganizationMember: vi.fn(),
  mockUseDeleteOrganization: vi.fn(),
  removeMemberMutateAsync: vi.fn(),
}));

const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  }),
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
  useOrganizationModules: () => ({ data: [{ id: 'vehicles', name: 'Vehículos', description: 'Placas y modelos.', enabled: true }], isLoading: false, isError: false }),
  useUpdateOrganizationModule: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
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
    mutateAsync: removeMemberMutateAsync,
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
      const table = screen.getByRole("table");
      expect(within(table).getByText("Juan Perez")).toBeInTheDocument();
      expect(within(table).getByText("juan@example.com")).toBeInTheDocument();
      expect(within(table).getByText("Maria Lopez")).toBeInTheDocument();
      expect(within(table).getByText("maria@example.com")).toBeInTheDocument();
    });

    it("renders a stacked member list for narrow containers with the same people", () => {
      const list = screen.getByTestId("org-member-list");
      expect(list.className).toContain("@3xl:hidden");
      expect(screen.getByRole("table").closest(".overflow-x-auto")!.className).toContain("@3xl:block");
      const rows = within(list).getAllByTestId("org-member-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText("Juan Perez")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Propietario")).toBeInTheDocument();
    });

    it("does not offer the retired OWNER role when adding a member", async () => {
      // OWNER is retired: the primary owner is an ADMIN membership with
      // isPrimaryOwner, and the API answers 400 to OWNER.
      await userEvent.click(screen.getByRole("button", { name: /Añadir miembro/ }));
      const dialog = screen.getByRole("dialog");
      await userEvent.click(within(dialog).getByLabelText("Rol"));
      const labels = (await screen.findAllByRole("option")).map((o) => o.textContent);
      expect(labels).toContain("Administrador");
      expect(labels).not.toContain("Propietario");
    });

    it("renders member roles in the table", () => {
      // Role selects use Spanish labels from roleOptions
      const adminOccurrences = screen.getAllByText("Administrador");
      expect(adminOccurrences.length).toBeGreaterThanOrEqual(1);
      const cashierOccurrences = screen.getAllByText("Cajero");
      expect(cashierOccurrences.length).toBeGreaterThanOrEqual(1);
    });

    it("renders primary owner indicator", () => {
      const siBadge = within(screen.getByRole("table")).getByText("S\u00ed");
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
        screen.getByText("Cargando organizaci\u00f3n…")
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
      // Select renders each role as a trigger <button> showing the
      // selected role label (no native combobox). Assert those are present.
      const roleButtons = screen
        .getAllByRole("button")
        .map((button) => button.textContent?.trim())
        .filter((text) => text === "Administrador" || text === "Cajero");
      expect(roleButtons.length).toBeGreaterThanOrEqual(1);
    });

    it("renders remove button for non-owner members", () => {
      expect(
        within(screen.getByRole("table")).getByRole("button", { name: "Acciones de Maria Lopez" })
      ).toBeInTheDocument();
    });

    it("renders an add member button", () => {
      const addButton = screen.getByText("A\u00f1adir miembro");
      expect(addButton).toBeInTheDocument();
    });
  });

  describe("member removal confirmation", () => {
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

    async function openRemovalDialog() {
      await userEvent.click(
        within(screen.getByRole("table")).getByRole("button", {
          name: "Acciones de Maria Lopez",
        }),
      );
      await userEvent.click(screen.getByRole("menuitem", { name: "Quitar" }));
      return screen.getByRole("dialog", { name: "Quitar miembro" });
    }

    it("asks for confirmation, naming the person and the organization, before calling the API", async () => {
      const dialog = await openRemovalDialog();

      expect(removeMemberMutateAsync).not.toHaveBeenCalled();
      expect(
        within(dialog).getByText(
          "Maria Lopez perderá el acceso a Tienda Principal.",
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Quitar" })).toBeInTheDocument();
    });

    it("removes the member once the confirmation is pending, then closes on success", async () => {
      let settle: () => void = () => {};
      removeMemberMutateAsync.mockReturnValue(
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      );
      const dialog = await openRemovalDialog();

      await userEvent.click(within(dialog).getByRole("button", { name: "Quitar" }));

      expect(removeMemberMutateAsync).toHaveBeenCalledTimes(1);
      expect(removeMemberMutateAsync).toHaveBeenCalledWith({
        orgId: "org-1",
        userId: "u-2",
      });
      // Still waiting: the dialog holds the reader until the server answers.
      expect(
        screen.getByRole("dialog", { name: "Quitar miembro" }),
      ).toBeInTheDocument();

      await act(async () => {
        settle();
      });

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Quitar miembro" })).toBeNull(),
      );
    });

    it("cancelling leaves the member in place and never calls the API", async () => {
      const dialog = await openRemovalDialog();

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Cancelar" }),
      );

      expect(removeMemberMutateAsync).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Quitar miembro" })).toBeNull();
      expect(
        within(screen.getByRole("table")).getByText("Maria Lopez"),
      ).toBeInTheDocument();
    });

    it("keeps the member and the dialog when the request fails, surfacing the error", async () => {
      removeMemberMutateAsync.mockRejectedValue(new Error("network"));
      const dialog = await openRemovalDialog();

      await userEvent.click(within(dialog).getByRole("button", { name: "Quitar" }));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith("No se pudo quitar el miembro"),
      );
      expect(
        screen.getByRole("dialog", { name: "Quitar miembro" }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("table")).getByText("Maria Lopez"),
      ).toBeInTheDocument();
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
