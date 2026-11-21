import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Eye } from "lucide-react";
import { formatDate, formatDateShort } from "@/lib/utils";
import { ExpenseCard } from "./ExpenseCard";
import type { Expense } from "@/types";

const partialExpense: Expense = {
  id: "exp-1",
  organizationId: "org-1",
  labelId: "label-1",
  label: {
    id: "label-1",
    organizationId: "org-1",
    groupId: "group-1",
    name: "Arriendo",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    group: {
      id: "group-1",
      organizationId: "org-1",
      name: "Gastos del local",
      active: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  },
  supplierId: "supplier-1",
  supplier: {
    id: "supplier-1",
    name: "Distribuidora Andina",
    documentNumber: "900123456-7",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  purchaseOrderId: null,
  description: "Renta agosto",
  date: "2026-08-01T00:00:00.000Z",
  total: 500000,
  status: "PARTIAL",
  receiptUrl: null,
  active: true,
  createdById: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  payments: [
    {
      id: "pay-1",
      expenseId: "exp-1",
      organizationId: "org-1",
      amount: 300000,
      method: "CASH",
      date: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ],
} as Expense;

const actions = [
  {
    label: "Editar gasto",
    icon: <Eye className="w-3.5 h-3.5" aria-hidden="true" />,
    onSelect: vi.fn(),
  },
];

describe("ExpenseCard", () => {
  it("reads as one card: category, description, supplier, date and amount", () => {
    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.getByText("Gastos del local")).toBeInTheDocument();
    expect(screen.getByText("Arriendo")).toBeInTheDocument();
    expect(screen.getByText("Renta agosto")).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Andina")).toBeInTheDocument();
    expect(screen.getByText(/500\.000/)).toBeInTheDocument();
    expect(screen.getByText("Parcial")).toBeInTheDocument();
  });

  it("states what is still owed next to the progress caption", () => {
    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.getByText("Saldo $ 200.000")).toBeInTheDocument();
    // The caption replaced the old line under the total, so it does not repeat.
    expect(screen.queryByText(/Saldo:/)).toBeNull();
  });

  it("replaces the bar with the settled strip once the salida is paid", () => {
    const { container } = render(
      <ExpenseCard
        expense={{
          ...partialExpense,
          status: "PAID",
          payments: [{ ...partialExpense.payments![0], amount: 500000 }],
        }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();

    const line = screen.getByTestId("expense-settled-line");
    // The strip keeps the bar + caption slot (28px) instead of collapsing to a
    // stray line of the description, so a paid card and a pending one in the
    // same grid row stay aligned.
    expect(line).toHaveClass("h-7", "w-full");
    expect(line).toHaveClass("border", "bg-muted/40");

    expect(within(line).getByText("Pagado completo")).toHaveClass(
      "text-xs",
      "font-medium",
    );
    expect(
      within(line).getByText(formatDateShort("2026-08-01T00:00:00.000Z")),
    ).toHaveClass("ml-auto", "text-muted-foreground");

    // Only the dot carries the colour; the strip itself never turns green.
    expect(line.className).not.toContain("bg-success");
    expect(within(line).getByText("Pagado completo").className).not.toContain(
      "text-success",
    );

    // The strip is a sibling of the description, not nested inside it, so the
    // card's gap-3 separates the two blocks.
    const description = container.querySelector("p.line-clamp-2") as HTMLElement;
    expect(description.nextElementSibling).toBe(line);
  });

  it("states the settled strip without a date when no payment carries one", () => {
    render(
      <ExpenseCard
        expense={{ ...partialExpense, status: "PAID", payments: [] }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.getByTestId("expense-settled-line").textContent).toBe(
      "Pagado completo",
    );
  });

  it("reads the day of the latest payment, not the first one in the list", () => {
    render(
      <ExpenseCard
        expense={{
          ...partialExpense,
          status: "PAID",
          payments: [
            {
              ...partialExpense.payments![0],
              id: "pay-2",
              amount: 400000,
              date: "2026-08-20T00:00:00.000Z",
            },
            {
              ...partialExpense.payments![0],
              id: "pay-1",
              amount: 100000,
              date: "2026-08-02T00:00:00.000Z",
            },
          ],
        }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(
      within(screen.getByTestId("expense-settled-line")).getByText(
        formatDateShort("2026-08-20T00:00:00.000Z"),
      ),
    ).toBeInTheDocument();
  });

  // The status field can lag behind the payments table: a fully covered salida
  // reads settled even before the server flips it to PAID.
  it("settles by the paid percentage when the status has not caught up", () => {
    render(
      <ExpenseCard
        expense={{
          ...partialExpense,
          status: "PARTIAL",
          payments: [{ ...partialExpense.payments![0], amount: 500000 }],
        }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByTestId("expense-settled-line")).toBeInTheDocument();
  });

  // S11: the separate eye control is gone; the card itself is the target and
  // keeps the accessible name the eye button used to carry.
  it("makes the whole card the detail control, named after the expense (S11)", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();

    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={onOpenDetail}
      />,
    );

    expect(screen.queryByTitle("Ver detalle")).toBeNull();

    const card = screen.getByRole("button", { name: "Ver detalle de Arriendo" });
    // The named element is the card, not a control inside it.
    expect(card).toHaveTextContent("Renta agosto");
    expect(card).toHaveAttribute("tabindex", "0");

    await user.click(card);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("opens the detail from the keyboard with Enter and Space (S11)", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();

    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={onOpenDetail}
      />,
    );

    screen.getByRole("button", { name: "Ver detalle de Arriendo" }).focus();

    await user.keyboard("{Enter}");
    expect(onOpenDetail).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
  });

  it("never opens the detail from the actions menu inside the card (S11)", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    const onSelect = vi.fn();

    render(
      <ExpenseCard
        expense={partialExpense}
        actions={[{ label: "Editar gasto", onSelect }]}
        onOpenDetail={onOpenDetail}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Más acciones de Arriendo" }),
    );
    expect(onOpenDetail).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: "Editar gasto" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  // The same paid-so-far block the loan and payroll cards carry: a bar read at
  // a glance, with the percentage and the balance stated underneath.
  it("summarises how much of the salida is paid in one bar and caption", () => {
    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    // 300.000 of 500.000 paid. Display only: the money stays the server's.
    const progress = screen.getByRole("progressbar", {
      name: "Pagado de Arriendo",
    });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).toHaveAttribute("aria-valuenow", "60");

    expect(screen.getByText("Pagado 60%")).toBeInTheDocument();
    expect(screen.getByText("Saldo $ 200.000")).toBeInTheDocument();

    const fill = screen.getByTestId("expense-progress-fill");
    expect(fill).toHaveStyle({ width: "60%" });
    expect(fill.className).toContain("bg-primary");
  });

  it("keeps the full bar while anything is still owed", () => {
    render(
      <ExpenseCard
        expense={{ ...partialExpense, status: "PARTIAL", payments: [] }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    // Nothing paid yet: the bar is the whole block, not a settled line.
    const progress = screen.getByRole("progressbar", {
      name: "Pagado de Arriendo",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Pagado 0%")).toBeInTheDocument();
    expect(screen.getByText("Saldo $ 500.000")).toBeInTheDocument();
    expect(screen.queryByTestId("expense-settled-line")).toBeNull();
  });

  it("tones the balance in the warning colour while money is still owed", () => {
    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.getByText("Saldo $ 200.000").className).toContain(
      "text-warning-text",
    );
  });

  // Proveedor and Fecha share one symmetric two-column row, so the blocks below
  // land at the same height whatever the supplier name measures.
  it("pairs Proveedor and Fecha in one two-column row", () => {
    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    const facts = screen.getByText("Proveedor").closest("dl");
    expect(facts).not.toBeNull();
    expect(screen.getByText("Fecha").closest("dl")).toBe(facts);
    expect(facts!.className).toContain("grid-cols-2");
    expect(facts!.children).toHaveLength(2);

    expect(within(facts as HTMLElement).getByText("Distribuidora Andina"))
      .toBeInTheDocument();
    // `Expense.date` is an instant, so the cell reads the compact day in the
    // reader's zone and keeps the prose wording in the `title`.
    const dateCell = within(facts as HTMLElement).getByText(
      formatDateShort(partialExpense.date),
    );
    expect(dateCell).toHaveAttribute("title", formatDate(partialExpense.date));
    expect(
      within(facts as HTMLElement).queryByText(formatDate(partialExpense.date)),
    ).toBeNull();
  });

  it("shows a dash in the supplier cell when the salida has none", () => {
    render(
      <ExpenseCard
        expense={{ ...partialExpense, supplierId: null, supplier: null }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    const facts = screen.getByText("Proveedor").closest("dl") as HTMLElement;
    expect(within(facts).getByText("—")).toBeInTheDocument();
  });

  it("marks an attached receipt without a second line of text", () => {
    render(
      <ExpenseCard
        expense={{ ...partialExpense, receiptUrl: "/receipts/1.png" }}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Comprobante adjunto")).toBeInTheDocument();
    expect(screen.queryByText("Comprobante adjunto")).toBeNull();
  });
});
