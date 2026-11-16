import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ExpenseFilters } from "./ExpenseFilters";

const labels = [
  { id: "l1", name: "Arriendo" },
  { id: "l2", name: "Servicios" },
];
const suppliers = [{ id: "s1", name: "Distribuidora Andina" }];

function setup(overrides: Partial<ComponentProps<typeof ExpenseFilters>> = {}) {
  const props: ComponentProps<typeof ExpenseFilters> = {
    search: "",
    onSearchChange: vi.fn(),
    month: "2026-11",
    onMonthChange: vi.fn(),
    labelId: "",
    onLabelChange: vi.fn(),
    labels,
    supplierId: "",
    onSupplierChange: vi.fn(),
    suppliers,
    status: "",
    onStatusChange: vi.fn(),
    hasFilters: false,
    onClear: vi.fn(),
    viewMode: "grid",
    onViewModeChange: vi.fn(),
    ...overrides,
  };
  render(<ExpenseFilters {...props} />);
  const toolbar = screen.getByRole("region", { name: "Filtros de salidas" });
  return { props, toolbar };
}

function selectTriggers(toolbar: HTMLElement) {
  return within(toolbar)
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("data-select-trigger"));
}

describe("ExpenseFilters", () => {
  it("keeps the search, every filter and the view switch in one toolbar", () => {
    const { toolbar } = setup();

    expect(within(toolbar).getByRole("searchbox")).toBeInTheDocument();
    expect(within(toolbar).getByLabelText("Mes")).toBeInTheDocument();
    expect(selectTriggers(toolbar)).toHaveLength(3);
    expect(
      within(toolbar).getByRole("group", { name: "Cambiar vista" }),
    ).toBeInTheDocument();
  });

  it("gives the search and every filter the same height and radius", () => {
    const { toolbar } = setup();

    const fields = [
      within(toolbar).getByRole("searchbox"),
      within(toolbar).getByLabelText("Mes"),
      ...selectTriggers(toolbar),
    ];

    for (const field of fields) {
      expect(field.className).toContain("sm:h-9");
      expect(field.className).toContain("rounded-lg");
    }
  });

  it("lays the filters on two columns until the desktop row takes over", () => {
    const { toolbar } = setup();

    const row = toolbar.firstElementChild as HTMLElement;
    expect(row.className).toContain("xl:flex-row");

    const filterGrid = Array.from(row.children).find((child) =>
      child.className.includes("grid-cols-2"),
    ) as HTMLElement | undefined;
    expect(filterGrid).toBeDefined();
    expect(filterGrid?.className).toContain("grid-cols-2");

    // The search takes whatever the filters leave on the desktop row.
    const searchWrapper = within(toolbar)
      .getByRole("searchbox")
      .closest("div") as HTMLElement;
    expect(searchWrapper.className).toContain("xl:flex-1");
  });

  it("names each select with a short default instead of a truncated sentence", () => {
    const { toolbar } = setup();

    expect(within(toolbar).getByText("Etiqueta")).toBeInTheDocument();
    expect(within(toolbar).getByText("Proveedor")).toBeInTheDocument();
    expect(within(toolbar).getByText("Estado")).toBeInTheDocument();
    expect(within(toolbar).queryByText(/Todas las etiquetas/)).toBeNull();
    expect(within(toolbar).queryByText(/Todos los proveedores/)).toBeNull();
    expect(within(toolbar).queryByText(/Todos los estados/)).toBeNull();
  });

  it("reports every change back with the value the list query expects", async () => {
    const user = userEvent.setup();
    const { props, toolbar } = setup();

    fireEvent.change(within(toolbar).getByRole("searchbox"), {
      target: { value: "renta" },
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("renta");

    fireEvent.change(within(toolbar).getByLabelText("Mes"), {
      target: { value: "2026-10" },
    });
    expect(props.onMonthChange).toHaveBeenCalledWith("2026-10");

    await user.click(selectTriggers(toolbar)[0]);
    await user.click(screen.getByRole("option", { name: "Arriendo" }));
    expect(props.onLabelChange).toHaveBeenCalledWith("l1");

    await user.click(within(toolbar).getByRole("button", { name: "Vista en lista" }));
    expect(props.onViewModeChange).toHaveBeenCalledWith("table");
  });

  it("offers the clear control while a filter is applied", async () => {
    const user = userEvent.setup();
    const { props, toolbar } = setup({ hasFilters: true, search: "renta" });

    await user.click(within(toolbar).getByRole("button", { name: "Limpiar" }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it("carries no clear control when nothing is filtered", () => {
    const { toolbar } = setup();

    expect(within(toolbar).queryByRole("button", { name: "Limpiar" })).toBeNull();
  });
});
