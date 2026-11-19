import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Eye } from "lucide-react";
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

  it("states what is still owed on a partially paid expense", () => {
    render(
      <ExpenseCard
        expense={partialExpense}
        actions={actions}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(screen.getByText(/Saldo: \$ 200\.000/)).toBeInTheDocument();
  });

  it("drops the balance line once the expense is paid", () => {
    render(
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

    expect(screen.queryByText(/Saldo:/)).toBeNull();
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
