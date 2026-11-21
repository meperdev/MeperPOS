import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type {
  PayrollInstallment,
  PayrollObligation,
} from "@/hooks/usePayroll";
import { ObligationCard } from "./ObligationCard";

// The card paints how much of the payment is already paid the same way the loan
// card does: one full-width bar plus a caption line under it stating the
// percentage on the left and the outstanding balance on the right. The server
// owns every money value here; the percentage is display-only.
const handlers = {
  onRegisterInstallment: vi.fn(),
  onCorrectInstallment: vi.fn(),
  onRegisterCashReturn: vi.fn(),
  onReplacePayment: vi.fn(),
};

function makeObligation(
  overrides: Partial<PayrollObligation> = {},
): PayrollObligation {
  return {
    id: "ob-period",
    employeeId: "emp-1",
    kind: "FIXED_PERIOD",
    status: "PENDING",
    version: 0,
    periodStart: "2025-01-01T00:00:00.000Z",
    periodEnd: "2025-01-31T00:00:00.000Z",
    periodAmount: "2000000.00",
    expenseEnabled: true,
    selectedExpenseDate: "2025-02-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    installments: [],
    shiftMemberships: [],
    summary: {
      total: "2000000.00",
      paid: "500000.00",
      balance: "1500000.00",
      status: "pending",
    },
    ...overrides,
  };
}

function makeInstallment({
  id = "inst-1",
  date = "2025-01-15",
  amount = "500000.00",
}: {
  id?: string;
  date?: string;
  amount?: string;
} = {}): PayrollInstallment {
  return {
    id,
    outflowId: `outflow-${id}`,
    createdAt: `${date}T00:00:00.000Z`,
    outflow: {
      id: `outflow-${id}`,
      amount,
      date,
      method: "CASH",
      createdAt: `${date}T00:00:00.000Z`,
    },
  };
}

function renderCard(obligation: PayrollObligation) {
  render(
    <ObligationCard
      obligation={obligation}
      employeeName="Ana Gómez"
      {...handlers}
    />,
  );
}

describe("ObligationCard progress", () => {
  it("paints the pending share on a full-width bar with the caption under it", () => {
    renderCard(makeObligation());

    // 500.000 of 2.000.000 paid: the percentage is display-only, the money stays
    // the server's.
    const progress = screen.getByRole("progressbar", {
      name: "Pagado de Ana Gómez",
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    // The bar spans its own row instead of sharing one with the percentage.
    expect(progress.className).toContain("h-1.5");
    expect(progress.className).toContain("w-full");
    expect(progress.className).not.toContain("flex-1");

    const fill = screen.getByTestId("payroll-progress-fill");
    expect(fill.className).toContain("h-full");
    expect(fill.className).toContain("rounded-full");
    expect(fill.className).toContain("bg-primary");
    expect(fill.className).not.toContain("bg-success");
    expect(fill.style.width).toBe("25%");

    // Caption line: percentage left, outstanding balance right.
    expect(screen.getByText("Pagado 25%")).toBeInTheDocument();
    const balance = screen.getByText("Saldo $ 1.500.000,00");
    expect(balance.className).toContain("font-semibold");
    expect(balance.className).toContain("text-warning-text");
    expect(balance.className).not.toContain("text-muted-foreground");
  });

  it("replaces the bar with the settled strip once the payment is complete", () => {
    renderCard(
      makeObligation({
        status: "COMPLETED",
        summary: {
          total: "2000000.00",
          paid: "2000000.00",
          balance: "0.00",
          status: "completed",
        },
      }),
    );

    expect(
      screen.queryByRole("progressbar", { name: "Pagado de Ana Gómez" }),
    ).toBeNull();

    const strip = screen.getByTestId("payroll-settled-line");
    expect(strip).toHaveClass("h-7", "w-full", "bg-muted/40");
    // Completed, but the payload carries no installment to date the strip from.
    expect(strip.textContent).toBe("Pagado completo");
  });

  it("dates the settled strip with the latest installment day", () => {
    renderCard(
      makeObligation({
        status: "COMPLETED",
        installments: [
          makeInstallment({ id: "inst-1", date: "2025-01-10" }),
          makeInstallment({ id: "inst-2", date: "2025-01-20" }),
        ],
        summary: {
          total: "2000000.00",
          paid: "2000000.00",
          balance: "0.00",
          status: "completed",
        },
      }),
    );

    const strip = screen.getByTestId("payroll-settled-line");
    expect(within(strip).getByText("Pagado completo")).toBeInTheDocument();
    // A `@db.Date` day reads through the payroll calendar-day formatter, like
    // the period above it and every installment row below it.
    expect(within(strip).getByText("20/01/2025")).toHaveClass(
      "ml-auto",
      "text-muted-foreground",
    );
  });
});
