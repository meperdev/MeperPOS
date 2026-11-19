import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import {
  closeCommandPalette,
  commandRecentsKey,
  isCommandPaletteOpen,
  openCommandPalette,
  recordCommandRecent,
} from "@/lib/command-palette";
import { SELECTED_ORGANIZATION_KEY } from "@/lib/session";
import { CommandPalette } from "./CommandPalette";

const apiMock = api as unknown as { get: ReturnType<typeof vi.fn> };
const pushMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/dashboard",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const productHit = {
  id: "product-1",
  name: "Arroz 1 kg",
  sku: "ALI-002",
  barcode: null,
  salePrice: 3500,
  effectiveSalePrice: 3200,
};

const customerHit = {
  id: "customer-1",
  name: "Ana Pérez",
  documentNumber: "10203040",
};

const saleHit = {
  id: "sale-1",
  saleNumber: 194,
  total: 12000,
  status: "COMPLETED",
  customer: { name: "Ana Pérez" },
};

function paginated<T>(data: T[]) {
  return {
    data: {
      data,
      meta: { total: data.length, page: 1, limit: 5, totalPages: 1 },
    },
  };
}

function respondByEndpoint() {
  apiMock.get.mockImplementation((url: string) => {
    if (url === "/products/search") return Promise.resolve({ data: [productHit] });
    if (url === "/customers") return Promise.resolve(paginated([customerHit]));
    if (url === "/sales") return Promise.resolve(paginated([saleHit]));
    return Promise.reject(new Error(`unexpected endpoint ${url}`));
  });
}

function setUser(role = "ADMIN") {
  useAuthMock.mockReturnValue({
    user: { id: "user-1", name: "Ana Pérez", role },
    organization: { id: "org-1" },
  });
}

/** The palette reads its groups through the app's query cache. */
function renderPalette(before?: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {before}
      <CommandPalette />
    </QueryClientProvider>,
  );
}

function openWithShortcut() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.getByRole("dialog", { name: "Buscar en MeperPOS" });
}

function group(key: string): HTMLElement {
  const element = document.querySelector(`[data-group="${key}"]`);
  if (!element) throw new Error(`no ${key} group`);
  return element as HTMLElement;
}

function groupOrder() {
  return screen
    .queryAllByTestId("palette-group")
    .map((group) => group.dataset.group);
}

function type(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(SELECTED_ORGANIZATION_KEY, "org-1");
  setUser();
  respondByEndpoint();
  closeCommandPalette();
});

afterEach(() => {
  cleanup();
  closeCommandPalette();
  localStorage.clear();
});

describe("CommandPalette opening", () => {
  it("opens from anywhere with Ctrl+K, even while typing in another field", () => {
    renderPalette(<input aria-label="otro campo" />);

    fireEvent.keyDown(window, { key: "k" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(
      screen.getByRole("dialog", { name: "Buscar en MeperPOS" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "placeholder",
      "Ej.: Arroz 1 kg, ALI-002, Ana Pérez, venta 194",
    );
  });

  it("closes with the same shortcut", () => {
    renderPalette();
    openWithShortcut();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(isCommandPaletteOpen()).toBe(false);
  });
});

describe("CommandPalette empty state", () => {
  it("lists recents, then Crear, then Ir a", () => {
    recordCommandRecent(commandRecentsKey("org-1"), {
      kind: "product",
      id: "product-1",
      label: "Arroz 1 kg",
    });
    renderPalette();
    openWithShortcut();

    expect(groupOrder()).toEqual(["recents", "create", "screens"]);
    expect(screen.getByText("Abiertos recientemente")).toBeInTheDocument();
    expect(screen.getByText("Crear")).toBeInTheDocument();
    expect(screen.getByText("Ir a")).toBeInTheDocument();
  });

  it("omits the recents group while nothing has been opened", () => {
    renderPalette();
    openWithShortcut();

    expect(groupOrder()).toEqual(["create", "screens"]);
    expect(screen.queryByText("Abiertos recientemente")).not.toBeInTheDocument();
  });

  it("shows only the recent entities of the selected organization", () => {
    recordCommandRecent(commandRecentsKey("org-1"), {
      kind: "customer",
      id: "customer-1",
      label: "Ana Pérez",
    });
    localStorage.setItem(SELECTED_ORGANIZATION_KEY, "org-2");
    renderPalette();
    openWithShortcut();

    expect(groupOrder()).toEqual(["create", "screens"]);
  });

  it("keeps Crear and Ir a inside the role's reach", () => {
    setUser("CASHIER");
    renderPalette();
    openWithShortcut();

    expect(screen.getByRole("option", { name: /Nueva venta/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Nueva orden de compra/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ventas/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Salidas/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Reportes/ }),
    ).not.toBeInTheDocument();
  });
});

describe("CommandPalette search", () => {
  it("waits for two characters before asking the API", async () => {
    renderPalette();
    openWithShortcut();

    type("a");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it("filters the Crear actions by the query, after Pantallas", async () => {
    renderPalette();
    openWithShortcut();

    type("nueva");

    const create = group("create");
    expect(
      within(create).getByRole("option", { name: /Nueva venta/ }),
    ).toBeInTheDocument();
    expect(
      within(create).getByRole("option", { name: /Nueva orden de compra/ }),
    ).toBeInTheDocument();
    expect(groupOrder().slice(0, 2)).toEqual(["screens", "create"]);
  });

  it("keeps the typed Crear group inside the role's reach", async () => {
    setUser("CASHIER");
    renderPalette();
    openWithShortcut();

    type("nueva");

    const create = group("create");
    expect(
      within(create).getByRole("option", { name: /Nueva venta/ }),
    ).toBeInTheDocument();
    expect(
      within(create).queryByRole("option", { name: /Nueva orden de compra/ }),
    ).not.toBeInTheDocument();
  });

  it("drops the Crear group while the query matches no action", async () => {
    renderPalette();
    openWithShortcut();

    type("ar");

    await waitFor(() =>
      expect(within(group("products")).getByText("Arroz 1 kg")).toBeInTheDocument(),
    );
    expect(groupOrder()).not.toContain("create");
  });

  it("lists products, customers and sale numbers for the typed term", async () => {
    renderPalette();
    openWithShortcut();

    type("ar");

    await waitFor(() =>
      expect(screen.getByText("Arroz 1 kg")).toBeInTheDocument(),
    );
    expect(within(group("customers")).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(group("sales")).getByText("Venta 194")).toBeInTheDocument();
    expect(groupOrder()).toEqual([
      "screens",
      "products",
      "customers",
      "sales",
    ]);
  });

  it("shows the server price for a product", async () => {
    renderPalette();
    openWithShortcut();

    type("ar");

    // effectiveSalePrice is the server's selling price, never a client calculation.
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Arroz 1 kg/ })).toHaveTextContent(
        "$ 3.200",
      ),
    );
  });

  it("sets a price in the text face and keeps identifiers in tabular sans", async () => {
    renderPalette();
    openWithShortcut();

    type("ar");

    // Money is read at a glance, never parsed digit by digit: sans, aligned.
    const price = await screen.findByText("$ 3.200");
    expect(price.className).toContain("tabular-nums");
    expect(price.className).not.toContain("font-mono");

    // A document number is an identifier: tabular figures in the same family.
    const document = screen.getByText("10203040");
    expect(document.className).toContain("id-text");
    expect(document.className).not.toContain("font-mono");
  });

  it("keeps the other groups when one endpoint fails", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/products/search") return Promise.resolve({ data: [productHit] });
      if (url === "/customers") return Promise.resolve(paginated([customerHit]));
      return Promise.reject(new Error("500"));
    });
    renderPalette();
    openWithShortcut();

    type("ar");

    await waitFor(() =>
      expect(
        screen.getByText("No se pudieron cargar las ventas."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Arroz 1 kg")).toBeInTheDocument();
    expect(within(group("customers")).getByText("Ana Pérez")).toBeInTheDocument();
  });

  it("says a group is empty instead of hiding the fact", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/products/search") return Promise.resolve({ data: [productHit] });
      return Promise.resolve(paginated([]));
    });
    renderPalette();
    openWithShortcut();

    type("ar");

    await waitFor(() =>
      expect(screen.getByText("Sin clientes.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Sin ventas.")).toBeInTheDocument();
  });

  it("collapses an entirely empty search into one sentence", async () => {
    apiMock.get.mockImplementation(() => Promise.resolve(paginated([])));
    renderPalette();
    openWithShortcut();

    type("zzz");

    await waitFor(() =>
      expect(
        screen.getByText("No encontramos resultados para «zzz»."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Sin productos.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin pantallas.")).not.toBeInTheDocument();
  });
});

describe("CommandPalette keyboard", () => {
  it("marks the field as a combobox with the active row selected", async () => {
    renderPalette();
    openWithShortcut();

    type("arr");
    await waitFor(() =>
      expect(screen.getByText("Arroz 1 kg")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveAttribute(
        "aria-activedescendant",
      ),
    );

    const input = screen.getByRole("combobox");
    const list = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);

    const active = document.getElementById(
      input.getAttribute("aria-activedescendant") ?? "",
    );
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveTextContent("Arroz 1 kg");
  });

  it("walks across groups and opens the highlighted product with Enter", async () => {
    renderPalette();
    openWithShortcut();

    type("arr");
    await waitFor(() =>
      expect(screen.getByText("Arroz 1 kg")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveAttribute(
        "aria-activedescendant",
      ),
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    // No search param exists on /inventory yet; the link still names the SKU.
    expect(pushMock).toHaveBeenCalledWith("/inventory?search=ALI-002");
    expect(isCommandPaletteOpen()).toBe(false);

    // Opening an entity from the palette is what fills the recents ledger.
    expect(JSON.parse(localStorage.getItem(commandRecentsKey("org-1")) ?? "[]")).toEqual([
      { kind: "product", id: "product-1", label: "Arroz 1 kg" },
    ]);
  });

  it("opens the customer history from a customer result", async () => {
    renderPalette();
    openWithShortcut();

    type("arr");
    await waitFor(() =>
      expect(within(group("customers")).getByText("Ana Pérez")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("option", { name: /^Ana Pérez/ }));

    expect(pushMock).toHaveBeenCalledWith(
      "/sales?customerId=customer-1&customerName=Ana%20P%C3%A9rez",
    );
  });

  it("opens the sale detail from a sale result", async () => {
    renderPalette();
    openWithShortcut();

    type("arr");
    await waitFor(() =>
      expect(screen.getByText("Venta 194")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("option", { name: /Venta 194/ }));

    expect(pushMock).toHaveBeenCalledWith("/sales/sale-1");
  });

  it("makes a hovered row the active one", async () => {
    renderPalette();
    openWithShortcut();

    type("arr");
    await waitFor(() =>
      expect(screen.getByText("Venta 194")).toBeInTheDocument(),
    );

    const sale = screen.getByRole("option", { name: /Venta 194/ });
    fireEvent.mouseEnter(sale);

    expect(sale).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("option", { name: /Arroz 1 kg/ }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("closes on Escape and gives the focus back to the opener", async () => {
    renderPalette(
      <button type="button" onClick={openCommandPalette}>
        Abrir buscador
      </button>,
    );

    const opener = screen.getByRole("button", { name: "Abrir buscador" });
    opener.focus();
    await userEvent.click(opener);
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
