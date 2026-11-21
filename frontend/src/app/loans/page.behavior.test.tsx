import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const loansMock = vi.fn();
const loanMock = vi.fn();
const historyMock = vi.fn();
const collectMock = vi.fn();
const completeMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

/** The kit Select labels its visible trigger; the hidden native select keeps the value semantics. */
function nativeSelectFor(scope: HTMLElement, label: string): HTMLSelectElement {
  const trigger = within(scope).getByRole("button", { name: label });
  const select = trigger.parentElement?.querySelector("select");
  if (!select) throw new Error(`No native select behind "${label}"`);
  return select;
}

vi.mock("@/hooks/useLoans", () => ({
  useLoans: (...args: unknown[]) => loansMock(...args),
  useLoan: (...args: unknown[]) => loanMock(...args),
  useLoanHistory: (...args: unknown[]) => historyMock(...args),
  useCollectLoan: () => ({ mutateAsync: collectMock, isPending: false }),
  useCompletePosLoan: () => ({ mutateAsync: completeMock, isPending: false }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ error: toastError, success: toastSuccess, info: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return {
    ...actual,
    formatCurrency: (value: number) => `COP ${value}`,
    // Deterministic so the modal/history date assertions prove `formatDateTime`
    // is fed the server timestamp without depending on the runner timezone.
    formatDateTime: (value: string | Date) => `DT ${String(value)}`,
    // Same reason: the card footer must read the compact day the server sent.
    formatCalendarDay: (value: string | Date) => `D ${String(value)}`,
    formatCalendarDayShort: (value: string | Date) => `DS ${String(value)}`,
  };
});

// The real input keeps internal display state; the form contract under test is
// the numeric onChange value, not the dot-separated formatting. It stays
// controlled so a quick action that fills the amount is observable.
vi.mock("@/components/ui/CurrencyInput", () => ({
  CurrencyInput: ({
    label,
    value,
    onChange,
  }: {
    label?: string;
    value?: number | string;
    onChange?: (value: number) => void;
  }) => (
    <input
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange?.(Number(event.target.value))}
    />
  ),
}));

import LoansPage from "./page";

function makeLoan(overrides: Record<string, unknown> = {}) {
  return {
    type: "MONEY",
    id: "loan-1",
    amount: "150.00",
    status: "OPEN",
    issuedAt: "2026-03-01T00:00:00.000Z",
    dueAt: null,
    reason: "Venta financiada",
    customerId: "customer-1",
    supplierId: null,
    employeeId: null,
    createdById: "user-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    customer: { id: "customer-1", name: "Ana Perez" },
    supplier: null,
    employee: null,
    createdBy: { id: "user-1", name: "Admin" },
    collected: "50.00",
    balance: "100.00",
    paymentStatus: "PARTIAL",
    posFinancing: { intentId: "intent-1", finalSaleId: "sale-1" },
    ...overrides,
  };
}

function makeEvent() {
  return {
    id: "event-1",
    loanId: "loan-1",
    type: "COLLECTED",
    amount: "50.00",
    method: "CASH",
    reversesId: null,
    reason: "Abono recibido",
    createdById: "user-1",
    createdAt: "2026-03-02T00:00:00.000Z",
    createdBy: { id: "user-1", name: "Admin" },
  };
}

const page = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 10,
  totalPages: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  loansMock.mockReturnValue({
    data: page([makeLoan()]),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  loanMock.mockReturnValue({ data: makeLoan(), isLoading: false, isError: false });
  historyMock.mockReturnValue({ data: page([makeEvent()]), isLoading: false });
  collectMock.mockResolvedValue({});
  completeMock.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Loans page", () => {
  it("lists loans as cards through useLoans with server-owned money values", () => {
    render(<LoansPage />);

    expect(loansMock).toHaveBeenCalledWith({ page: 1, limit: 10 });
    // The list is a set of cards now: no table survives the redesign.
    expect(screen.queryByRole("table")).toBeNull();

    const cards = screen.getAllByTestId("loan-card");
    expect(cards).toHaveLength(1);

    const card = within(cards[0]);
    expect(card.getByText("Ana Perez")).toBeTruthy();
    expect(card.getByText("Efectivo")).toBeTruthy();
    expect(card.getByText("Abierto")).toBeTruthy();
    expect(card.getByText("Monto")).toBeTruthy();
    expect(card.getByText("Abonado")).toBeTruthy();
    expect(card.getByText("Saldo")).toBeTruthy();
    expect(card.getByText("COP 150")).toBeTruthy();
    expect(card.getByText("COP 50")).toBeTruthy();
    expect(card.getByText("COP 100")).toBeTruthy();
  });

  it("renders one card per loan in a responsive grid", () => {
    loansMock.mockReturnValue({
      data: page([
        makeLoan(),
        makeLoan({
          id: "loan-2",
          type: "SERVICE",
          status: "CLOSED",
          customer: null,
          supplier: { id: "supplier-1", name: "Distribuidora Sur" },
        }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    expect(screen.getAllByTestId("loan-card")).toHaveLength(2);
    expect(screen.getByTestId("loan-cards").className).toContain(
      "grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]",
    );
    expect(screen.getByTestId("loan-cards").className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols/);
    expect(screen.getByText("Distribuidora Sur")).toBeTruthy();
    expect(screen.getByText("Servicio")).toBeTruthy();
    expect(screen.getByText("Cerrado")).toBeTruthy();
  });

  it("summarises how much of the loan is paid on the card", () => {
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    // 50 of 150 paid: the percentage is display-only, the money stays the
    // server's (amount/collected/balance arrive already computed).
    const progress = card.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("33");
    expect(card.getByText(/Abonado 33%/)).toBeTruthy();
    expect(card.getByText("Saldo COP 100")).toBeTruthy();
    expect(card.getByTestId("loan-progress-fill").className).toContain("bg-primary");
  });

  it("replaces the bar with the settled strip once the loan is settled", () => {
    loansMock.mockReturnValue({
      data: page([
        makeLoan({
          status: "CLOSED",
          collected: "150.00",
          balance: "0.00",
          paymentStatus: "PAID",
        }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    expect(card.queryByRole("progressbar")).toBeNull();
    // The list payload carries no closing or last-collection day, so the strip
    // states the settled verdict alone.
    const strip = card.getByTestId("loan-settled-line");
    expect(strip.textContent).toBe("Saldado");
    expect(strip).toHaveClass("h-7", "w-full", "bg-muted/40");
    // The money triple below still states the zero balance.
    expect(card.getByText("COP 0")).toBeTruthy();
  });

  it("settles a loan whose balance reached zero before its status flipped", () => {
    loansMock.mockReturnValue({
      data: page([
        makeLoan({ status: "OPEN", collected: "150.00", balance: "0.00" }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    expect(card.queryByRole("progressbar")).toBeNull();
    expect(card.getByTestId("loan-settled-line")).toBeTruthy();
  });

  // Cancelled is not paid: cancelling a loan writes the debt off, so a zero
  // balance there says nothing about the money coming back in.
  it("never reads a cancelled loan as settled, even with a zero balance", () => {
    loansMock.mockReturnValue({
      data: page([
        makeLoan({
          status: "CANCELLED",
          collected: "50.00",
          balance: "0.00",
          paymentStatus: "UNPAID",
        }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    expect(card.queryByTestId("loan-settled-line")).toBeNull();

    // It keeps the bar and the caption it always carried: 50 of 150 collected.
    const progress = card.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("33");
    expect(card.getByText("Abonado 33%")).toBeTruthy();
    expect(card.getByText("Saldo COP 0")).toBeTruthy();
    expect(card.getByTestId("loan-progress-fill").className).toContain(
      "bg-primary",
    );
  });

  it("shows the issue and due dates in the card footer", () => {
    loansMock.mockReturnValue({
      // Far enough ahead that the card cannot read as overdue whatever the day
      // the suite runs on.
      data: page([makeLoan({ dueAt: "2099-04-01T00:00:00.000Z" })]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    expect(card.getByText("Inicio")).toBeTruthy();
    // The narrow footer cell reads the compact day; the prose wording stays
    // reachable in the `title`.
    const issued = card.getByText("DS 2026-03-01T00:00:00.000Z");
    expect(issued).toHaveAttribute("title", "D 2026-03-01T00:00:00.000Z");
    expect(card.queryByText("D 2026-03-01T00:00:00.000Z")).toBeNull();
    expect(card.getByText("Vence")).toBeTruthy();
    const due = card.getByText("DS 2099-04-01T00:00:00.000Z");
    expect(due).toHaveAttribute("title", "D 2099-04-01T00:00:00.000Z");
    expect(card.queryByText("Vencido")).toBeNull();
  });

  it("marks an open loan whose due day has passed as overdue", () => {
    loansMock.mockReturnValue({
      data: page([makeLoan({ dueAt: "2020-01-01T00:00:00.000Z" })]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    expect(card.getByText("Vencido")).toBeTruthy();
    expect(card.getByText("DS 2020-01-01T00:00:00.000Z").className).toContain(
      "text-danger-text",
    );
  });

  it("keeps a loan due today out of overdue late in the shop's evening", () => {
    // Bogotá is UTC-5, so 21:00 there is already 02:00Z of the next day. The
    // due day is a calendar day in shop time: today's deadline is not late yet.
    vi.useFakeTimers({ now: new Date("2026-11-21T02:00:00.000Z") });
    loansMock.mockReturnValue({
      data: page([
        makeLoan({ dueAt: "2026-11-20T00:00:00.000Z" }),
        makeLoan({ id: "loan-2", dueAt: "2026-11-19T00:00:00.000Z" }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const [dueToday, dueYesterday] = screen
      .getAllByTestId("loan-card")
      .map((card) => within(card));
    expect(dueToday.queryByText("Vencido")).toBeNull();
    // The boundary still moves at the shop's midnight, not later.
    expect(dueYesterday.getByText("Vencido")).toBeTruthy();
  });

  it("leaves a past due date on a closed loan unmarked", () => {
    loansMock.mockReturnValue({
      data: page([
        makeLoan({
          status: "CLOSED",
          collected: "150.00",
          balance: "0.00",
          paymentStatus: "PAID",
          dueAt: "2020-01-01T00:00:00.000Z",
        }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    const card = within(screen.getAllByTestId("loan-card")[0]);
    expect(card.queryByText("Vencido")).toBeNull();
    expect(card.getByText("DS 2020-01-01T00:00:00.000Z").className).not.toContain(
      "text-danger-text",
    );
  });

  it("shows the loading state while the list is pending", () => {
    loansMock.mockReturnValue({ isLoading: true, isError: false });
    render(<LoansPage />);
    expect(screen.getByText(/Cargando préstamos/i)).toBeTruthy();
  });

  it("shows the empty state when there are no loans", () => {
    loansMock.mockReturnValue({
      data: page([]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);
    expect(screen.getByText(/Sin préstamos registrados/i)).toBeTruthy();
  });

  it("surfaces the list error through getApiErrorMessage and retries", async () => {
    const refetch = vi.fn();
    loansMock.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      refetch,
    });
    render(<LoansPage />);

    expect(screen.getByText(/No se pudieron cargar los préstamos/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("opens one loan to load its detail and history", async () => {
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    expect(loanMock).toHaveBeenCalledWith("loan-1");
    expect(historyMock).toHaveBeenCalledWith("loan-1");
    expect(screen.getByText("Venta financiada")).toBeTruthy();
    expect(screen.getByText(/Abono/)).toBeTruthy();
  });

  it("shows the loan's type, creation date, author and counterparty in the modal", async () => {
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    const modal = within(screen.getByTestId("loan-detail"));
    expect(modal.getByTestId("loan-type").textContent).toBe("Efectivo");
    expect(modal.getByTestId("loan-created-by").textContent).toBe("Admin");
    expect(modal.getByTestId("loan-created-at").textContent).toBe(
      "DT 2026-03-01T00:00:00.000Z",
    );
    expect(modal.getByTestId("loan-counterparty").textContent).toBe("Ana Perez");
    // This loan has no due date, so that field stays out of the modal.
    expect(modal.queryByTestId("loan-due-at")).toBeNull();
  });

  it("shows the due date when the loan carries one", async () => {
    loanMock.mockReturnValue({
      data: makeLoan({ dueAt: "2026-04-01T00:00:00.000Z" }),
      isLoading: false,
      isError: false,
    });
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    expect(screen.getByTestId("loan-due-at").textContent).toBe(
      "DT 2026-04-01T00:00:00.000Z",
    );
  });

  it("references the linked financed sale in the modal", async () => {
    loanMock.mockReturnValue({
      data: makeLoan({
        posFinancing: {
          intentId: "intent-1",
          finalSaleId: "sale-42",
          finalSaleNumber: 427,
        },
      }),
      isLoading: false,
      isError: false,
    });
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    const financing = within(screen.getByTestId("pos-financing"));
    expect(financing.getByTestId("pos-financing-sale").textContent).toBe(
      "#427",
    );
    expect(screen.queryByTestId("pos-financing-pending")).toBeNull();
  });

  it("says the financed sale is not linked yet when finalSaleId is null", async () => {
    loanMock.mockReturnValue({
      data: makeLoan({
        posFinancing: { intentId: "intent-1", finalSaleId: null },
      }),
      isLoading: false,
      isError: false,
    });
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    expect(screen.getByTestId("pos-financing-pending").textContent).toMatch(
      /no ha sido vinculada/i,
    );
    expect(screen.queryByTestId("pos-financing-sale")).toBeNull();
  });

  it("omits the financing section for an ordinary loan", async () => {
    loanMock.mockReturnValue({
      data: makeLoan({ posFinancing: null }),
      isLoading: false,
      isError: false,
    });
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    expect(screen.queryByTestId("pos-financing")).toBeNull();
  });

  it("never offers the completion action for an ordinary loan with a zero balance", async () => {
    loanMock.mockReturnValue({
      data: makeLoan({
        posFinancing: null,
        collected: "150.00",
        balance: "0.00",
        paymentStatus: "PAID",
      }),
      isLoading: false,
      isError: false,
    });
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    expect(
      screen.queryByRole("button", { name: "Completar venta financiada" }),
    ).toBeNull();
  });

  it("fills the collection amount with the whole remaining balance", async () => {
    const user = userEvent.setup();
    render(<LoansPage />);
    await user.click(screen.getByText("Ana Perez"));

    await user.click(
      screen.getByRole("button", { name: "Pagar saldo restante" }),
    );

    expect(screen.getByLabelText("Monto del abono")).toHaveValue("100");
  });

  it("shows each history row with its date and author", async () => {
    historyMock.mockReturnValue({ data: page([makeEvent()]), isLoading: false });
    render(<LoansPage />);
    await userEvent.click(screen.getByText("Ana Perez"));

    const rows = screen.getAllByTestId("loan-history-row");
    expect(rows).toHaveLength(1);

    const row = within(rows[0]);
    expect(row.getByText("Abono")).toBeTruthy();
    expect(row.getByText("DT 2026-03-02T00:00:00.000Z")).toBeTruthy();
    expect(row.getByText("Admin")).toBeTruthy();
    expect(row.getByText("COP 50")).toBeTruthy();
  });

  it("mints a new collection key when the amount is corrected after a rejected attempt", async () => {
    const user = userEvent.setup();
    collectMock
      .mockRejectedValueOnce(new Error("rejected"))
      .mockResolvedValueOnce({});

    render(<LoansPage />);
    await user.click(screen.getByText("Ana Perez"));
    await user.type(screen.getByLabelText("Monto del abono"), "25");
    const submit = screen.getByRole("button", { name: "Registrar abono" });

    await user.click(submit);
    await waitFor(() => expect(collectMock).toHaveBeenCalledTimes(1));

    // The rejection was deterministic: the cashier corrects the amount, which
    // is a different request and must not reuse the rejected key.
    await user.clear(screen.getByLabelText("Monto del abono"));
    await user.type(screen.getByLabelText("Monto del abono"), "40");
    await user.click(submit);
    await waitFor(() => expect(collectMock).toHaveBeenCalledTimes(2));

    const [first, second] = collectMock.mock.calls.map((call) => call[0]);
    expect(second).toMatchObject({ id: "loan-1", amount: 40 });
    expect(second.requestKey).not.toBe(first.requestKey);
  });

  it("pins one request key per collection attempt and rotates it after success", async () => {
    const user = userEvent.setup();
    collectMock
      .mockRejectedValueOnce(new Error("uncertain"))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    render(<LoansPage />);
    await user.click(screen.getByText("Ana Perez"));
    await user.type(screen.getByLabelText("Monto del abono"), "25");
    await user.selectOptions(nativeSelectFor(document.body, "Método"), "CARD");
    const submit = screen.getByRole("button", { name: "Registrar abono" });

    await user.click(submit);
    await waitFor(() => expect(collectMock).toHaveBeenCalledTimes(1));
    await user.click(submit);
    await waitFor(() => expect(collectMock).toHaveBeenCalledTimes(2));

    const [first, second] = collectMock.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({ id: "loan-1", amount: 25, method: "CARD" });
    expect(second.requestKey).toBe(first.requestKey);
    expect(toastError).toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Monto del abono"));
    await user.type(screen.getByLabelText("Monto del abono"), "10");
    await user.click(submit);
    await waitFor(() => expect(collectMock).toHaveBeenCalledTimes(3));
    expect(collectMock.mock.calls[2][0].requestKey).not.toBe(first.requestKey);
  });

  it("completes a paid financed sale sending only the request key", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LoansPage />);
    await user.click(screen.getByText("Ana Perez"));

    // Unpaid financing: the completion action does not apply yet.
    expect(
      screen.queryByRole("button", { name: "Completar venta financiada" }),
    ).toBeNull();

    loanMock.mockReturnValue({
      data: makeLoan({
        posFinancing: { intentId: "intent-1", finalSaleId: "sale-1" },
        collected: "150.00",
        balance: "0.00",
        paymentStatus: "PAID",
      }),
      isLoading: false,
      isError: false,
    });
    rerender(<LoansPage />);

    await user.click(
      screen.getByRole("button", { name: "Completar venta financiada" }),
    );
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(completeMock.mock.calls[0][0]).toEqual({
      id: "loan-1",
      requestKey: expect.any(String),
    });
  });

  it("requests the next page through the pagination control", async () => {
    loansMock.mockReturnValue({
      data: { data: [makeLoan()], total: 25, page: 1, limit: 10, totalPages: 3 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<LoansPage />);

    await userEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(loansMock).toHaveBeenLastCalledWith({ page: 2, limit: 10 });
  });
});
