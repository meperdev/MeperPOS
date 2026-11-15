import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Expense, ExpenseAuditEntry } from "@/types";

const useExpenseHistoryMock = vi.fn();

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children: ReactNode;
  }) =>
    isOpen ? (
      <section>
        {title ? <h2>{title}</h2> : null}
        {children}
      </section>
    ) : null,
}));

vi.mock("@/hooks/useExpenses", () => ({
  useExpenseHistory: (id: string) => useExpenseHistoryMock(id),
}));

import { ExpenseDetailModal } from "./ExpenseDetailModal";

const expense = {
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
  supplierId: "sup-1",
  supplier: {
    id: "sup-1",
    organizationId: "org-1",
    name: "Proveedor Uno",
    document: "900123456",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  purchaseOrderId: "po-1",
  purchaseOrder: {
    id: "po-1",
    orderNumber: 101,
    supplierId: "sup-1",
    createdById: "user-1",
    status: "RECEIVED",
    subtotal: 0,
    taxAmount: 0,
    total: 0,
  },
  description: "Renta agosto",
  date: "2026-08-01T00:00:00.000Z",
  total: "500000",
  status: "PARTIAL",
  receiptUrl: "https://cdn.example.com/receipt.png",
  active: true,
  createdById: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  payments: [
    {
      id: "pay-1",
      expenseId: "exp-1",
      organizationId: "org-1",
      amount: "300000",
      method: "CASH",
      date: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "pay-2",
      expenseId: "exp-1",
      organizationId: "org-1",
      amount: "50000",
      method: "CARD",
      date: "2026-08-05T00:00:00.000Z",
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  ],
  // Decimal fields arrive as strings at runtime (backend Decimal serialization)
} as unknown as Expense;

const entries: ExpenseAuditEntry[] = [
  {
    id: "a-1",
    userId: "user-1",
    action: "EXPENSE_CREATED",
    resource: "Expense",
    resourceId: "exp-1",
    metadata: {},
    createdAt: "2026-08-01T10:00:00.000Z",
    organizationId: "org-1",
    user: { name: "Ana Admin", email: "ana@example.com" },
  },
  {
    id: "a-2",
    userId: "user-1",
    action: "EXPENSE_PAYMENT_ADDED",
    resource: "Expense",
    resourceId: "exp-1",
    metadata: {},
    createdAt: "2026-08-02T10:00:00.000Z",
    organizationId: "org-1",
    user: { name: "Ana Admin", email: "ana@example.com" },
  },
];

describe("ExpenseDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExpenseHistoryMock.mockReturnValue({
      data: entries,
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders total, status, group and label, supplier, purchase order and description", () => {
    render(<ExpenseDetailModal expense={expense} isOpen onClose={vi.fn()} />);

    expect(screen.getByText("Detalle del gasto")).toBeInTheDocument();
    expect(screen.getByText(/500\.000/)).toBeInTheDocument();
    expect(screen.getByText("Parcial")).toBeInTheDocument();
    expect(screen.getByText("Gastos del local / Arriendo")).toBeInTheDocument();
    expect(screen.getByText("Proveedor Uno")).toBeInTheDocument();
    expect(screen.getByText("OC-101")).toBeInTheDocument();
    expect(screen.getByText("Renta agosto")).toBeInTheDocument();
  });

  it("shows the receipt image when the expense has one", () => {
    render(<ExpenseDetailModal expense={expense} isOpen onClose={vi.fn()} />);

    const image = screen.getByAltText("Comprobante del gasto");
    expect(image).toHaveAttribute("src", "https://cdn.example.com/receipt.png");
  });

  it("shows a placeholder when the expense has no receipt", () => {
    render(
      <ExpenseDetailModal
        expense={{ ...expense, receiptUrl: null } as unknown as Expense}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Sin factura o comprobante adjunto")).toBeInTheDocument();
  });

  it("renders payments with method labels and the remaining amount", () => {
    render(<ExpenseDetailModal expense={expense} isOpen onClose={vi.fn()} />);

    expect(screen.getByText(/^\$\s300\.000$/)).toBeInTheDocument();
    expect(screen.getByText(/^\$\s50\.000$/)).toBeInTheDocument();
    expect(screen.getByText(/Efectivo/)).toBeInTheDocument();
    expect(screen.getByText(/Tarjeta/)).toBeInTheDocument();
    expect(screen.getByText("Pendiente:")).toBeInTheDocument();
    expect(screen.getByText(/^\$\s150\.000$/)).toBeInTheDocument();
  });

  it("renders the two-column receipt panel and keeps audit history in its own modal", () => {
    render(<ExpenseDetailModal expense={expense} isOpen onClose={vi.fn()} />);

    expect(screen.getByText("Comprobante o factura adjunta")).toBeInTheDocument();
    expect(screen.getByText(/Abonos y pagos/)).toBeInTheDocument();
    expect(screen.getByText(/Pagado:/)).toBeInTheDocument();
    // Audit history now lives in HistoryModal (see history-modal.test.tsx), not inside the detail modal.
    expect(screen.queryByText("Gasto creado")).not.toBeInTheDocument();
  });

  it("still loads the audit history hook but keeps the modal focused on the receipt", () => {
    useExpenseHistoryMock.mockReturnValue({ data: undefined, isLoading: true });

    render(<ExpenseDetailModal expense={expense} isOpen onClose={vi.fn()} />);

    expect(useExpenseHistoryMock).toHaveBeenCalledWith("exp-1");
    expect(screen.getByText("Total registrado")).toBeInTheDocument();
    expect(screen.queryByText(/Cargando historial/)).not.toBeInTheDocument();
  });
});
