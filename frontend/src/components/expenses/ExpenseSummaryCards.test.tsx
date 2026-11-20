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

    // The total is the largest figure in the block: display scale, tabular digits.
    const total = within(region).getByText(/3\.420\.000/);
    expect(total.className).toContain("tabular-nums");
    expect(total.className).toMatch(/text-(3|4)xl/);

    // The period reads as a month, never as the raw `YYYY-MM` input value.
    expect(within(region).getByText(/noviembre de 2026/i)).toBeInTheDocument();
    expect(within(region).queryByText(/2026-11/)).toBeNull();
    expect(within(region).getByText(/5 grupos/)).toBeInTheDocument();
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

    // Every amount the server returned stays visible, on its own row.
    [
      /2\.000\.000$/,
      /1\.000\.000$/,
      /250\.000$/,
      /120\.000$/,
      /50\.000$/,
    ].forEach((amount, index) => {
      expect(within(rows[index]).getByText(amount)).toBeInTheDocument();
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

  it("draws one stacked bar segment per group from the categorical chart scale", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const bar = within(summaryRegion()).getByRole("img", {
      name: /Distribución del mes/i,
    });

    const segments = Array.from(bar.children) as HTMLElement[];
    expect(segments).toHaveLength(summary.groups.length);

    // Category colours, never status tokens and never literal hex values.
    segments.forEach((segment, index) => {
      expect(segment.style.backgroundColor).toBe(`var(--chart-${index + 1})`);
      expect(Number.parseFloat(segment.style.width)).toBeGreaterThan(0);
    });

    // The bar carries its own readable summary for assistive tech.
    expect(bar.getAttribute("aria-label")).toMatch(
      /Gastos de empleados 58\s*%/,
    );
  });

  it("keeps the group labels short and says how many more there are", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const [employees, , transport] = within(summaryRegion()).getAllByRole(
      "listitem",
    );

    // Two labels fit inline, the remainder collapses into a single count.
    expect(within(employees).getByText("Sueldos · Prestaciones")).toBeTruthy();
    expect(within(employees).getByText("+1")).toBeTruthy();
    expect(within(employees).queryByText("Bonificaciones")).toBeNull();

    expect(within(transport).getByText("Combustible · Peajes")).toBeTruthy();
    expect(within(transport).queryByText(/^\+/)).toBeNull();
  });

  it("keeps the groups as rows of one card instead of separate cards", () => {
    render(<ExpenseSummaryCards month="2026-11" summary={summary} />);

    const region = summaryRegion();
    expect(region.className).toContain("bg-card");

    // A row that is a rounded, shadowed card would rebuild the floating cards
    // this summary replaces; the rows only carry dividers.
    for (const row of within(region).getAllByRole("listitem")) {
      expect(row.className).not.toMatch(/rounded|shadow/);
      expect(row.className).not.toContain("bg-card");
    }
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
    expect(row.lastElementChild?.textContent).toBe("<1 %");
    expect(within(row).getByText("Sin etiquetas")).toBeInTheDocument();
  });

  it("says the month is empty instead of drawing a bar with no groups", () => {
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

    const bar = within(region).getByRole("img", {
      name: /Distribución del mes/i,
    });
    expect(bar.children).toHaveLength(0);
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
