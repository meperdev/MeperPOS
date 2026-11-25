import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { LocationSite, StockTransfer } from "@/types";

const {
  createMock,
  receiveMock,
  cancelMock,
  useTransfersMock,
  toastSuccess,
  toastError,
  state,
} = vi.hoisted(() => {
  const state = {
    transfers: [] as StockTransfer[],
    isLoading: false,
    isError: false,
  };
  return {
    createMock: vi.fn(),
    receiveMock: vi.fn(),
    cancelMock: vi.fn(),
    useTransfersMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    state,
  };
});

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getApiErrorMessage: () => "Existencias insuficientes en la sede de origen",
  };
});

vi.mock("@/hooks/useTransfers", () => ({
  useTransfers: (params: unknown) => {
    useTransfersMock(params);
    return {
      data: state.isLoading || state.isError
        ? undefined
        : {
            data: state.transfers,
            meta: {
              total: state.transfers.length,
              page: 1,
              limit: 10,
              totalPages: 1,
            },
          },
      isLoading: state.isLoading,
      isError: state.isError,
      refetch: vi.fn(),
    };
  },
  useTransfer: () => ({ data: undefined }),
  useCreateTransfer: () => ({ mutateAsync: createMock, isPending: false }),
  useReceiveTransfer: () => ({ mutateAsync: receiveMock, isPending: false }),
  useCancelTransfer: () => ({ mutateAsync: cancelMock, isPending: false }),
}));

const sites: LocationSite[] = [
  { id: "site-a", name: "Sede centro", type: "STORE", isDefault: true },
  { id: "site-b", name: "Bodega norte", type: "WAREHOUSE", isDefault: false },
];

vi.mock("@/hooks/useLocations", () => ({
  useLocations: () => ({ data: sites, isLoading: false }),
}));

const products = [
  {
    id: "prod-1",
    name: "Producto Uno",
    sku: "SKU-1",
    costPrice: 100,
    salePrice: 150,
    taxRate: 19,
    stock: 10,
    availableStock: 5,
    minStock: 1,
    active: true,
    categoryId: "cat-1",
  },
];

const productsParams = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useProducts", () => ({
  useProducts: (params: unknown) => {
    productsParams(params);
    return { data: { data: products }, isFetching: false };
  },
}));

import TransfersPage from "./page";

function makeTransfer(overrides: Partial<StockTransfer> = {}): StockTransfer {
  return {
    id: "transfer-1",
    number: 7,
    organizationId: "org-a",
    status: "IN_TRANSIT",
    fromLocationId: "site-a",
    toLocationId: "site-b",
    fromLocation: { id: "site-a", name: "Sede centro", type: "STORE" },
    toLocation: { id: "site-b", name: "Bodega norte", type: "WAREHOUSE" },
    notes: null,
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Ana" },
    createdAt: "2026-11-25T14:00:00.000Z",
    receivedAt: null,
    receivedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    items: [
      {
        id: "item-1",
        productId: "prod-1",
        quantity: 3,
        product: { id: "prod-1", name: "Producto Uno", sku: "SKU-1" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  state.transfers = [makeTransfer()];
  state.isLoading = false;
  state.isError = false;
  vi.clearAllMocks();
  createMock.mockResolvedValue(makeTransfer());
  receiveMock.mockResolvedValue(makeTransfer({ status: "RECEIVED" }));
  cancelMock.mockResolvedValue(makeTransfer({ status: "CANCELLED" }));
});

afterEach(cleanup);

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  const [row] = screen.getAllByRole("button", {
    name: "Ver transferencia TR-7",
  });
  await user.click(row);
  return screen.getByRole("dialog");
}

describe("transfers page", () => {
  it("lists each transfer with its number, route, state, items and date", () => {
    render(<TransfersPage />);

    expect(screen.getAllByText("TR-7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sede centro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bodega norte").length).toBeGreaterThan(0);
    expect(screen.getAllByText("En tránsito").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 ítem").length).toBeGreaterThan(0);
    expect(screen.getByText("1 transferencia")).toBeInTheDocument();
  });

  it("filters by state and by site", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole("button", { name: "Todos los estados" }));
    await user.click(await screen.findByRole("option", { name: "Recibida" }));

    await waitFor(() =>
      expect(useTransfersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "RECEIVED", page: 1 }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Todas las sedes" }));
    await user.click(await screen.findByRole("option", { name: "Bodega norte" }));

    await waitFor(() =>
      expect(useTransfersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ siteId: "site-b", page: 1 }),
      ),
    );
  });

  it("invites the first transfer when there is none", () => {
    state.transfers = [];
    render(<TransfersPage />);

    expect(screen.getByText("Sin transferencias todavía")).toBeInTheDocument();
  });

  it("dispatches the chosen lines from origin to destination", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole("button", { name: /Nueva transferencia/ }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Sede de origen" }));
    await user.click(await screen.findByRole("option", { name: /Sede centro/ }));
    await user.click(within(dialog).getByRole("button", { name: "Sede de destino" }));
    await user.click(await screen.findByRole("option", { name: /Bodega norte/ }));

    await user.type(within(dialog).getByLabelText("Productos"), "Producto");
    // Only what the origin site can send is offered, with that site's units.
    expect(productsParams).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: "site-a", available: true }),
    );
    expect(
      await screen.findByRole("option", { name: /Producto Uno.*5 disp\./ }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: /Producto Uno/ }));
    const quantity = within(dialog).getByRole("group", {
      name: "Cantidad de Producto Uno",
    });
    const more = within(quantity).getByRole("button", {
      name: "Aumentar cantidad",
    });
    for (let step = 0; step < 3; step += 1) await user.click(more);
    expect(within(quantity).getByLabelText("Cantidad")).toHaveValue("4");

    await user.click(
      within(dialog).getByRole("button", { name: "Despachar transferencia" }),
    );

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        fromLocationId: "site-a",
        toLocationId: "site-b",
        items: [{ productId: "prod-1", quantity: 4 }],
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Transferencia despachada", {
      description: "TR-7",
    });
  });

  it("caps a line at the units the origin site can send", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole("button", { name: /Nueva transferencia/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Productos")).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Sede de origen" }));
    await user.click(await screen.findByRole("option", { name: /Sede centro/ }));
    await user.type(within(dialog).getByLabelText("Productos"), "Producto");
    await user.click(await screen.findByRole("option", { name: /Producto Uno/ }));

    const quantity = within(dialog).getByRole("group", {
      name: "Cantidad de Producto Uno",
    });
    const more = within(quantity).getByRole("button", {
      name: "Aumentar cantidad",
    });
    for (let step = 0; step < 6; step += 1) await user.click(more);
    expect(within(quantity).getByLabelText("Cantidad")).toHaveValue("5");
    expect(more).toBeDisabled();
  });

  it("refuses to dispatch to the same site", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole("button", { name: /Nueva transferencia/ }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Sede de origen" }));
    await user.click(await screen.findByRole("option", { name: /Sede centro/ }));
    await user.click(within(dialog).getByRole("button", { name: "Sede de destino" }));
    await user.click(await screen.findByRole("option", { name: /Sede centro/ }));

    expect(
      within(dialog).getByRole("alert"),
    ).toHaveTextContent("La sede de origen y la de destino deben ser diferentes.");
    expect(
      within(dialog).getByRole("button", { name: "Despachar transferencia" }),
    ).toBeDisabled();
  });

  it("receives an in-transit transfer from its detail", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    const dialog = await openDetail(user);
    expect(within(dialog).getByText("TR-7")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Recibir" }));

    await waitFor(() =>
      expect(receiveMock).toHaveBeenCalledWith({ id: "transfer-1" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Transferencia recibida", {
      description: "TR-7",
    });
  });

  it("cancels with a mandatory trimmed reason", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    const detail = await openDetail(user);
    await user.click(within(detail).getByRole("button", { name: "Cancelar" }));

    const cancelDialog = screen.getByRole("dialog", { name: "Cancelar TR-7" });
    const confirm = within(cancelDialog).getByRole("button", {
      name: "Cancelar transferencia",
    });
    expect(confirm).toBeDisabled();

    await user.type(
      within(cancelDialog).getByLabelText("Motivo"),
      "  La bodega no la recibe  ",
    );
    await user.click(confirm);

    await waitFor(() =>
      expect(cancelMock).toHaveBeenCalledWith({
        id: "transfer-1",
        reason: "La bodega no la recibe",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Transferencia cancelada", {
      description: "TR-7",
    });
  });

  it("reports a rejected dispatch with the server message", async () => {
    createMock.mockRejectedValueOnce(new Error("conflict"));
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole("button", { name: /Nueva transferencia/ }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Sede de origen" }));
    await user.click(await screen.findByRole("option", { name: /Sede centro/ }));
    await user.click(within(dialog).getByRole("button", { name: "Sede de destino" }));
    await user.click(await screen.findByRole("option", { name: /Bodega norte/ }));
    await user.type(within(dialog).getByLabelText("Productos"), "Producto");
    await user.click(await screen.findByRole("option", { name: /Producto Uno/ }));
    await user.click(
      within(dialog).getByRole("button", { name: "Despachar transferencia" }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(
      "No se pudo despachar la transferencia",
      {
        description: "Existencias insuficientes en la sede de origen",
      },
    );
    // The dialog stays open so the form is not lost with the failure.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be read", () => {
    state.isError = true;
    render(<TransfersPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las transferencias.",
    );
    expect(
      screen.getByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  });
});
