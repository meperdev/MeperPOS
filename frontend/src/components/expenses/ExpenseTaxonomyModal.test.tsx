import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  createGroupMock,
  updateGroupMock,
  deleteGroupMock,
  createLabelMock,
  updateLabelMock,
  deleteLabelMock,
  useAuthMock,
  useExpenseGroupsMock,
} = vi.hoisted(() => ({
  createGroupMock: vi.fn(),
  updateGroupMock: vi.fn(),
  deleteGroupMock: vi.fn(),
  createLabelMock: vi.fn(),
  updateLabelMock: vi.fn(),
  deleteLabelMock: vi.fn(),
  useAuthMock: vi.fn(),
  useExpenseGroupsMock: vi.fn(),
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    children,
    title,
    size,
    footer,
  }: {
    children: React.ReactNode;
    title: string;
    size?: string;
    footer?: React.ReactNode;
  }) => (
    <section data-testid="taxonomy-modal" data-size={size}>
      <h2>{title}</h2>
      {children}
      {footer}
    </section>
  ),
}));

vi.mock("@/hooks/useExpenses", () => ({
  useExpenseGroups: () => useExpenseGroupsMock(),
  useCreateExpenseGroup: () => ({ mutateAsync: createGroupMock, isPending: false }),
  useUpdateExpenseGroup: () => ({ mutateAsync: updateGroupMock, isPending: false }),
  useDeleteExpenseGroup: () => ({ mutateAsync: deleteGroupMock, isPending: false }),
  useCreateExpenseLabel: () => ({ mutateAsync: createLabelMock, isPending: false }),
  useUpdateExpenseLabel: () => ({ mutateAsync: updateLabelMock, isPending: false }),
  useDeleteExpenseLabel: () => ({ mutateAsync: deleteLabelMock, isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ExpenseTaxonomyModal } from "./ExpenseTaxonomyModal";

describe("ExpenseTaxonomyModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { role: "ADMIN" } });
    useExpenseGroupsMock.mockReturnValue({
      data: [
        {
          id: "g1",
          name: "Gastos del local",
          active: true,
          labels: [{ id: "l1", name: "Arriendo", active: true }],
        },
        {
          id: "g2",
          name: "Servicios",
          active: true,
          labels: [],
        },
      ],
    });
    createGroupMock.mockResolvedValue({ id: "g3", name: "Publicidad" });
    updateGroupMock.mockResolvedValue({});
    deleteGroupMock.mockResolvedValue({});
    createLabelMock.mockResolvedValue({ id: "l2", name: "Agua" });
    updateLabelMock.mockResolvedValue({});
    deleteLabelMock.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("renders a lg master-detail layout with one active group and one new-label input", () => {
    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId("taxonomy-modal")).toHaveAttribute("data-size", "lg");
    expect(screen.getByRole("button", { name: /^Gastos del local/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Gastos del local" })).toBeInTheDocument();
    expect(screen.getByText("Arriendo")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Nueva etiqueta" })).toHaveLength(1);
    expect(screen.getAllByRole("textbox", { name: "Nuevo grupo" })).toHaveLength(1);
  });

  it("switches the detail workspace when another group is selected", async () => {
    const user = userEvent.setup();
    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^Servicios/ }));

    expect(screen.getByRole("heading", { name: "Servicios" })).toBeInTheDocument();
    expect(screen.getByText("Sin etiquetas en este grupo")).toBeInTheDocument();
    expect(screen.queryByText("Arriendo")).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "Nueva etiqueta" }), "Energía");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(createLabelMock).toHaveBeenCalledWith({
      groupId: "g2",
      data: { name: "Energía" },
    });
  });

  it("cancels inline rename on Escape without firing an update", async () => {
    const user = userEvent.setup();
    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Renombrar etiqueta Arriendo" }));
    const editInput = screen.getByRole("textbox", { name: "Renombrar Arriendo" });
    await user.clear(editInput);
    await user.type(editInput, "Otro nombre{Escape}");

    expect(updateLabelMock).not.toHaveBeenCalled();
    expect(screen.getByText("Arriendo")).toBeInTheDocument();
  });

  it("requires inline confirmation before deleting a group or label", async () => {
    const user = userEvent.setup();
    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);

    const deleteLabelBtn = screen.getByRole("button", {
      name: "Eliminar etiqueta Arriendo",
    });
    const labelContainer = deleteLabelBtn.closest("li")!;
    await user.click(deleteLabelBtn);
    expect(deleteLabelMock).not.toHaveBeenCalled();

    await user.click(within(labelContainer).getByRole("button", { name: "¿Eliminar?" }));
    expect(deleteLabelMock).toHaveBeenCalledWith({ groupId: "g1", id: "l1" });

    const deleteGroupBtn = screen.getByRole("button", {
      name: "Eliminar grupo Gastos del local",
    });
    const groupHeader = deleteGroupBtn.parentElement!.parentElement!;
    await user.click(deleteGroupBtn);
    expect(deleteGroupMock).not.toHaveBeenCalled();

    await user.click(within(groupHeader).getByRole("button", { name: "¿Eliminar?" }));
    expect(deleteGroupMock).toHaveBeenCalledWith("g1");
  });

  it("renders nothing for non-admin roles", () => {
    useAuthMock.mockReturnValue({ user: { role: "CASHIER" } });
    const { container } = render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows ErrorState with retry when loading groups fails", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    useExpenseGroupsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las categorías",
    );
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
