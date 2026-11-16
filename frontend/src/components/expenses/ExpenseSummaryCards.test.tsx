import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ExpenseSummaryCards } from "./ExpenseSummaryCards";

const summary = {
  month: "2026-08",
  total: 900000,
  groups: [
    {
      groupId: "g1",
      name: "Gastos del local",
      total: 500000,
      labels: [
        { labelId: "l1", name: "Arriendo", total: 300000 },
        { labelId: "l2", name: "Servicios", total: 200000 },
      ],
    },
    {
      groupId: "g2",
      name: "Gastos de empleados",
      total: 250000,
      labels: [{ labelId: "l3", name: "Sueldos", total: 250000 }],
    },
    {
      groupId: "g3",
      name: "Caja menor",
      total: 150000,
      labels: [{ labelId: "l4", name: "Alimentación", total: 150000 }],
    },
  ],
};

describe("ExpenseSummaryCards", () => {
  it("holds the month total and every group total in one segmented strip", () => {
    render(<ExpenseSummaryCards month="2026-08" summary={summary} />);

    const strip = screen.getByRole("region", { name: "Resumen del mes" });

    expect(within(strip).getByText("Total del mes")).toBeInTheDocument();
    expect(within(strip).getByText(/900\.000/)).toBeInTheDocument();

    // Every group the server returned, not only the first two.
    for (const name of [
      "Gastos del local",
      "Gastos de empleados",
      "Caja menor",
    ]) {
      expect(within(strip).getByText(name)).toBeInTheDocument();
    }
    expect(within(strip).getAllByText(/500\.000/).length).toBeGreaterThan(0);
    expect(within(strip).getAllByText(/250\.000/).length).toBeGreaterThan(0);
    expect(within(strip).getAllByText(/150\.000/).length).toBeGreaterThan(0);

    // The period the numbers belong to stays stated.
    expect(within(strip).getByText(/Período: 2026-08/)).toBeInTheDocument();
    expect(within(strip).getByText(/3 grupos/)).toBeInTheDocument();
  });

  it("draws the cells as segments of one surface instead of separate cards", () => {
    render(<ExpenseSummaryCards month="2026-08" summary={summary} />);

    const strip = screen.getByRole("region", { name: "Resumen del mes" });

    // A cell that is a rounded, shadowed card would rebuild the floating cards
    // this strip replaces; the segments only carry hairlines.
    expect(strip.querySelectorAll('[class*="rounded"]')).toHaveLength(0);
    expect(strip.querySelectorAll('[class*="shadow"]')).toHaveLength(0);
  });

  it("sizes the columns from the cell count so no track is left empty", () => {
    const oneGroup = { ...summary, groups: [summary.groups[0]] };
    const { unmount } = render(
      <ExpenseSummaryCards month="2026-08" summary={oneGroup} />,
    );
    const twoCells = screen.getByRole("region", { name: "Resumen del mes" })
      .firstElementChild;
    expect(twoCells?.className).toContain("grid-cols-2");
    unmount();

    // Total + three groups = four cells, four tracks from `sm` up.
    render(<ExpenseSummaryCards month="2026-08" summary={summary} />);
    const fourCells = screen.getByRole("region", { name: "Resumen del mes" })
      .firstElementChild;
    expect(fourCells?.className).toContain("sm:grid-cols-4");
  });

  it("keeps a single total segment while the month has no categories yet", () => {
    render(
      <ExpenseSummaryCards
        month="2026-08"
        summary={{ month: "2026-08", total: 0, groups: [] }}
      />,
    );

    const strip = screen.getByRole("region", { name: "Resumen del mes" });
    expect(within(strip).getByText("Total del mes")).toBeInTheDocument();
    expect(within(strip).getByText(/0 grupos/)).toBeInTheDocument();
    expect(strip.firstElementChild?.className).toContain("grid-cols-1");
  });
});
