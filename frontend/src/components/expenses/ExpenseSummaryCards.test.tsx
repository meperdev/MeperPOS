import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ExpenseSummaryCards } from "./ExpenseSummaryCards";

const summary = {
  month: "2026-11",
  total: 3420000,
  // Deliberately not in amount order: the component owns the ranking.
  groups: [
    {
      groupId: "g4",
      name: "Caja menor",
      total: 120000,
      labels: [{ labelId: "l7", name: "Alimentación", total: 120000 }],
    },
    {
      groupId: "g1",
      name: "Gastos de empleados",
      total: 2000000,
      labels: [
        { labelId: "l1", name: "Sueldos", total: 1500000 },
        { labelId: "l2", name: "Prestaciones", total: 400000 },
        { labelId: "l3", name: "Bonificaciones", total: 100000 },
      ],
    },
    {
      groupId: "g5",
      name: "Herramientas y equipos",
      total: 50000,
      labels: [{ labelId: "l8", name: "Mantenimiento", total: 50000 }],
    },
    {
      groupId: "g2",
      name: "Mercancía",
      total: 1000000,
      labels: [{ labelId: "l4", name: "Compra a proveedor", total: 1000000 }],
    },
    {
      groupId: "g3",
      name: "Transporte",
      total: 250000,
      labels: [
        { labelId: "l5", name: "Combustible", total: 200000 },
        { labelId: "l6", name: "Peajes", total: 50000 },
      ],
    },
  ],
};

function summaryRegion() {
  return screen.getByRole("region", { name: "Resumen del mes" });
}

describe("ExpenseSummaryCards", () => {
  it("leads with the month total and names the month in words", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const region = summaryRegion();
    expect(within(region).getByText("Total del mes")).toBeInTheDocument();

    // The total leads the strip, a step above the group cells and tabular so
    // the digits align.
    const total = within(region).getByText(/3\.420\.000/);
    expect(total.className).toContain("tabular-nums");
    expect(total.className).toContain("text-2xl");
    expect(total.className).toContain("sm:text-[28px]");

    // The period reads as a month, never as the raw `YYYY-MM` input value.
    expect(within(region).getByText(/noviembre de 2026/i)).toBeInTheDocument();
    expect(within(region).queryByText(/2026-11/)).toBeNull();
    const groupCount = within(region).getByText(/5 grupos/);
    expect(groupCount).toBeInTheDocument();

    // The meta line sits one step above the floor, not at table-caption size.
    expect(groupCount.closest("p")?.className).toContain("text-[13px]");
  });

  it("ranks the groups by amount so the largest reads first", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const rows = within(summaryRegion()).getAllByRole("listitem");
    expect(rows).toHaveLength(5);

    // Ranked from the largest amount down, regardless of the server order.
    [
      "Gastos de empleados",
      "Mercancía",
      "Transporte",
      "Caja menor",
      "Herramientas y equipos",
    ].forEach((name, index) => {
      expect(within(rows[index]).getByText(name)).toBeInTheDocument();
    });

    // Every amount the server returned stays visible, on its own cell.
    [
      /2\.000\.000$/,
      /1\.000\.000$/,
      /250\.000$/,
      /120\.000$/,
      /50\.000$/,
    ].forEach((amount, index) => {
      expect(
        within(rows[index]).getByText(amount, { selector: "p" }),
      ).toBeInTheDocument();
    });
  });

  it("states each group's share of the month", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const rows = within(summaryRegion()).getAllByRole("listitem");

    // 2.000.000 of 3.420.000, then 1.000.000 of 3.420.000.
    expect(within(rows[0]).getByText(/58\s*%/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/29\s*%/)).toBeInTheDocument();
    // A small group never reads as an impossible share of the month.
    expect(within(rows[4]).getByText(/1\s*%/)).toBeInTheDocument();
  });

  it("keeps the groups as hairline cells of one card, never as floating tiles", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const region = summaryRegion();
    expect(region.className).toContain("bg-card");
    expect(region.className).toContain("overflow-hidden");

    const cells = within(region).getAllByRole("listitem");
    expect(cells).toHaveLength(5);
    for (const cell of cells) {
      // Cells of one surface: a hairline, never another plate inside the card.
      expect(cell.className).not.toContain("bg-card");
      expect(cell.className).not.toContain("bg-muted");
      expect(cell.className).not.toContain("rounded");
      expect(cell.className).not.toMatch(/shadow/);
      expect(cell.className).toContain("border-r");
      expect(cell.className).toContain("border-b");
      expect(cell.className).toContain("border-border/60");
      expect(cell.className).toContain("p-4");
    }
  });

  it("lays up to six cells in one row only once there is room, and wraps longer months", () => {
    const { unmount } = render(
      <ExpenseSummaryCards month="2026-11" summary={summary} />,
    );

    // Five groups plus the total make six cells. The strip stays two across on
    // a phone and three across at `lg`, where six tracks would squeeze a
    // currency amount; it only reaches one row from `xl`.
    const strip = screen.getByTestId("expense-summary-strip");
    expect(strip.className).toContain("grid");
    expect(strip.className).toContain("grid-cols-2");
    expect(strip.className).toContain("md:grid-cols-3");
    expect(strip.className).toContain("xl:grid-cols-6");
    expect(strip.className).not.toContain("lg:grid-cols");

    const totalCell = within(summaryRegion())
      .getByText("Total del mes")
      .closest("div") as HTMLElement;
    expect(totalCell.className).toContain("col-span-2");
    expect(totalCell.className).toContain("md:col-span-1");

    unmount();

    // Seven groups plus the total cannot fit one row even at `xl`: four columns
    // wrap instead of eight.
    render(
      <ExpenseSummaryCards
        month="2026-11"
        summary={{
          ...summary,
          groups: [
            ...summary.groups,
            { groupId: "g6", name: "Servicios", total: 40000, labels: [] },
            { groupId: "g7", name: "Papelería", total: 30000, labels: [] },
          ],
        }}
      />,
    );

    const wrapped = screen.getByTestId("expense-summary-strip");
    expect(wrapped.className).toContain("md:grid-cols-3");
    expect(wrapped.className).toContain("xl:grid-cols-4");
    expect(wrapped.className).not.toContain("xl:grid-cols-8");
  });

  it("draws no proportion bars at all, only the coloured identity dot", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const region = summaryRegion();

    // No stacked bar and no per-group bar: nothing in the block carries a
    // computed width.
    expect(within(region).queryByRole("img")).toBeNull();
    const sized = Array.from(
      region.querySelectorAll<HTMLElement>("[style]"),
    ).filter((el) => el.style.width !== "");
    expect(sized).toHaveLength(0);

    // The colour survives as the dot that identifies each group.
    const dots = Array.from(
      region.querySelectorAll<HTMLElement>('[style*="background-color"]'),
    );
    expect(dots).toHaveLength(summary.groups.length);
    dots.forEach((dot, index) => {
      expect(dot.style.backgroundColor).toBe(`var(--chart-${index + 1})`);
      expect(dot.className).toContain("rounded-full");
      expect(dot.className).toContain("h-2");
      expect(dot.className).toContain("w-2");
    });
  });

  it("keeps every text inside the type scale: 12px floor, no micro-print", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const region = summaryRegion();
    const cells = within(region).getAllByRole("listitem");

    // The group name reads at a size that is actually visible, the amount leads
    // its cell, and the share stays on the 12px floor.
    const name = within(cells[0]).getByText("Gastos de empleados");
    expect(name).toHaveClass("text-[13px]");
    expect(name).toHaveClass("font-medium");
    expect(within(cells[0]).getByText(/58\s*%/)).toHaveClass("text-xs");
    expect(within(cells[0]).getByText(/2\.000\.000/)).toHaveClass("text-xl");

    const offenders = Array.from(
      region.querySelectorAll<HTMLElement>('[class*="text-["]'),
    ).filter((el) => /text-\[1[01]px\]/.test(el.className));
    expect(offenders).toHaveLength(0);
  });

  it("lists each group's labels beside their own amounts and counts the rest", () => {
    const { unmount } = render(
      <ExpenseSummaryCards month="2026-11" summary={summary} />,
    );

    const employees = within(summaryRegion()).getAllByRole("listitem")[0];

    // Three labels fit as rows, each beside the amount it explains.
    expect(within(employees).getByText("Sueldos")).toBeInTheDocument();
    expect(within(employees).getByText("Prestaciones")).toBeInTheDocument();
    expect(within(employees).getByText("Bonificaciones")).toBeInTheDocument();
    expect(within(employees).getByText(/1\.500\.000/)).toBeInTheDocument();
    expect(within(employees).getByText(/400\.000/)).toBeInTheDocument();
    expect(within(employees).queryByText(/^\+/)).toBeNull();

    unmount();

    render(
      <ExpenseSummaryCards
        month="2026-11"
        summary={{
          month: "2026-11",
          total: 100000,
          groups: [
            {
              groupId: "many",
              name: "Operación",
              total: 100000,
              labels: [
                { labelId: "m1", name: "Uno", total: 40000 },
                { labelId: "m2", name: "Dos", total: 25000 },
                { labelId: "m3", name: "Tres", total: 20000 },
                { labelId: "m4", name: "Cuatro", total: 10000 },
                { labelId: "m5", name: "Cinco", total: 5000 },
              ],
            },
          ],
        }}
      />,
    );

    const many = within(summaryRegion()).getByRole("listitem");
    expect(within(many).getByText("Tres")).toBeInTheDocument();
    expect(within(many).queryByText("Cuatro")).toBeNull();
    expect(within(many).getByText("+2 más")).toBeInTheDocument();
  });

  it("keeps a tiny group from reading as no share at all", () => {
    render(
      <ExpenseSummaryCards
        month="2026-11"
        summary={{
          month: "2026-11",
          total: 1000000,
          groups: [
            { groupId: "tiny", name: "Café", total: 2000, labels: [] },
          ],
        }}
      />,
    );

    const row = within(summaryRegion()).getByRole("listitem");
    // 0.2 % of the month rounds to zero, so it is stated as a floor instead.
    expect(within(row).getByText("<1 %")).toBeInTheDocument();
    expect(within(row).getByText("Sin etiquetas")).toBeInTheDocument();
  });

  it("says the month is empty instead of drawing cells with no groups", () => {
    render(
      <ExpenseSummaryCards
        month="2026-11"
        summary={{ month: "2026-11", total: 0, groups: [] }}
      />,
    );

    const region = summaryRegion();
    expect(within(region).getByText("Total del mes")).toBeInTheDocument();
    expect(within(region).getByText(/0 grupos/)).toBeInTheDocument();
    expect(
      within(region).getByText(/Sin grupos con gastos este mes/),
    ).toBeInTheDocument();

    expect(within(region).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("counts a single group in the singular", () => {
    render(
      <ExpenseSummaryCards
        month="2026-11"
        summary={{ ...summary, groups: [summary.groups[3]] }}
      />,
    );

    const region = summaryRegion();
    expect(within(region).getByText(/1 grupo/)).toBeInTheDocument();
    expect(within(region).queryByText(/1 grupos/)).toBeNull();
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  });

  it("holds a quiet placeholder instead of a zero total while the summary loads", () => {
    render(<ExpenseSummaryCards month="2026-11" />);

    const region = screen.getByRole("region", { name: "Resumen del mes" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).queryByText(/\$\s*0$/)).toBeNull();
    expect(within(region).queryByText(/Sin grupos/)).toBeNull();
    expect(within(region).getByText("Total del mes")).toBeInTheDocument();
  });
});
