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
  authState,
} = vi.hoisted(() => {
  const state = {
    transfers: [] as StockTransfer[],
    isLoading: false,
    isError: false,
    summary: { inTransit: 1, received: 2, cancelled: 3 },
  };
  return {
    createMock: vi.fn(),
    receiveMock: vi.fn(),
    cancelMock: vi.fn(),
    useTransfersMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    state,
    /**
     * S6: the same screen serves the destination cashier and the administrators.
     * A platform super admin carries `isSuperAdmin` and may have no tenant role.
     */
    authState: {
      role: "ADMIN" as string | undefined,
      isSuperAdmin: false,
    },
  };
});

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      name: "Ana",
      role: authState.role,
      isSuperAdmin: authState.isSuperAdmin,
    },
  }),
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
  useTransferSummary: () => ({ data: state.summary, isLoading: false }),
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

const VIEW_MODE_KEY = "meperpos:view-mode:transfers";

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
  state.summary = { inTransit: 1, received: 2, cancelled: 3 };
  authState.role = "ADMIN";
  authState.isSuperAdmin = false;
  window.localStorage.setItem(VIEW_MODE_KEY, "grid");
  vi.clearAllMocks();
  createMock.mockResolvedValue(makeTransfer());
  receiveMock.mockResolvedValue(makeTransfer({ status: "RECEIVED" }));
  cancelMock.mockResolvedValue(makeTransfer({ status: "CANCELLED" }));
});

afterEach(() => {
  window.localStorage.removeItem(VIEW_MODE_KEY);
  cleanup();
});

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

  it("counts the transfers in each state for the current site scope", () => {
    state.summary = { inTransit: 4, received: 12, cancelled: 2 };
    render(<TransfersPage />);

    const summary = screen.getByTestId("transfer-summary");
    expect(within(summary).getByText("En tránsito")).toBeInTheDocument();
    expect(within(summary).getByText("4")).toBeInTheDocument();
    expect(within(summary).getByText("12")).toBeInTheDocument();
    expect(within(summary).getByText("2")).toBeInTheDocument();
  });

  it("filters by state and by site", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(screen.getByRole("button", { name: "Recibidas" }));

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

  it("switches between the cards and the dense table", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    // Cards are the default layout: a phone always gets them.
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Vista en lista" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Ruta")).toBeInTheDocument();
    expect(within(table).getAllByText("TR-7").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Vista en tarjeta" })).toBeInTheDocument();
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

    await user.type(within(dialog).getByLabelText("Buscar producto"), "Producto");
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
    expect(within(dialog).getByLabelText("Buscar producto")).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Sede de origen" }));
    await user.click(await screen.findByRole("option", { name: /Sede centro/ }));
    await user.type(within(dialog).getByLabelText("Buscar producto"), "Producto");
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

  it("lets a cashier read and receive without dispatching or cancelling", async () => {
    authState.role = "CASHIER";
    const user = userEvent.setup();
    render(<TransfersPage />);

    // The list is readable: a cashier sees what is coming to its store.
    expect(screen.getAllByText("TR-7").length).toBeGreaterThan(0);
    // Dispatch and cancellation are administrative; the entry points are gone.
    expect(
      screen.queryByRole("button", { name: /Nueva transferencia/ }),
    ).toBeNull();

    const dialog = await openDetail(user);
    expect(
      within(dialog).getByRole("button", { name: "Recibir" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Cancelar" }),
    ).toBeNull();
  });

  it("tells a cashier where the stock will arrive when there is nothing to receive", () => {
    authState.role = "CASHIER";
    state.transfers = [];
    render(<TransfersPage />);

    expect(screen.getByText("Sin transferencias todavía")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cuando otra sede te envíe mercancía, aparecerá aquí para recibirla.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Nueva transferencia/),
    ).not.toBeInTheDocument();
  });

  it("keeps dispatch and cancellation for an administrator", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    expect(
      screen.getByRole("button", { name: /Nueva transferencia/ }),
    ).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(
      within(dialog).getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Recibir" }),
    ).toBeInTheDocument();
  });

  it("lets a platform super admin dispatch", () => {
    authState.role = "SUPER_ADMIN";
    authState.isSuperAdmin = true;
    render(<TransfersPage />);

    expect(
      screen.getByRole("button", { name: /Nueva transferencia/ }),
    ).toBeInTheDocument();
  });

  it("lets a platform super admin session without a tenant role dispatch", () => {
    // The server admits SUPER_ADMIN; a platform identity that carries no org
    // role of its own is the one shape the role list alone would lock out.
    authState.role = undefined;
    authState.isSuperAdmin = true;
    render(<TransfersPage />);

    expect(
      screen.getByRole("button", { name: /Nueva transferencia/ }),
    ).toBeInTheDocument();
  });

  it("cancels an in-transit transfer from the card menu", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(
      screen.getByRole("button", { name: "Más acciones de TR-7" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Cancelar transferencia" }));

    expect(
      screen.getByRole("dialog", { name: "Cancelar TR-7" }),
    ).toBeInTheDocument();
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
    await user.type(within(dialog).getByLabelText("Buscar producto"), "Producto");
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
