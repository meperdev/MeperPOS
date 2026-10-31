import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import PayrollPage from "./page";

// The screen must read money exactly as the server sent it and never derive it.
// These fixtures make the server summary deliberately disagree with the cash
// rows so any client-side arithmetic would be visible in the assertions.
const state = vi.hoisted(() => ({
  role: "ADMIN",
  obligationsEnabled: null as boolean | null,
  obligations: {
    data: [] as unknown[],
    isLoading: false,
    isError: false,
    refetch: () => undefined as unknown,
  },
  employees: { data: [] as unknown[] },
  shifts: { data: [] as unknown[], isLoading: false, isError: false },
  createPeriod: (() => undefined) as unknown,
  createGroup: (() => undefined) as unknown,
  createPeriodInstallment: (() => undefined) as unknown,
  createGroupInstallment: (() => undefined) as unknown,
  correctPeriodInstallment: (() => undefined) as unknown,
  createCashReturn: (() => undefined) as unknown,
  createReplacement: (() => undefined) as unknown,
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/hooks/useEmployees", () => ({ useEmployees: () => state.employees }));
vi.mock("@/hooks/useEmployeeShifts", () => ({ useEmployeeShifts: () => state.shifts }));
vi.mock("@/hooks/usePayroll", () => ({
  usePayrollObligations: (enabled: boolean) => {
    state.obligationsEnabled = enabled;
    return state.obligations;
  },
  useCreatePayrollPeriod: () => ({ mutateAsync: state.createPeriod }),
  useCreatePayrollGroup: () => ({ mutateAsync: state.createGroup }),
  useCreatePayrollPeriodInstallment: () => ({ mutateAsync: state.createPeriodInstallment }),
  useCreatePayrollGroupInstallment: () => ({ mutateAsync: state.createGroupInstallment }),
  useCorrectPayrollPeriodInstallment: () => ({ mutateAsync: state.correctPeriodInstallment }),
  useCreatePayrollCashReturn: () => ({ mutateAsync: state.createCashReturn }),
  useCreatePayrollReplacementPayment: () => ({ mutateAsync: state.createReplacement }),
}));

const employees = [
  { id: "emp-1", name: "Ana Gómez", active: true },
  { id: "emp-2", name: "Luis Prado", active: true },
];

const installment = {
  id: "inst-1",
  outflowId: "out-1",
  createdAt: "2025-01-15T12:00:00.000Z",
  outflow: {
    id: "out-1",
    amount: "111111.00",
    date: "2025-01-15T00:00:00.000Z",
    method: "CASH",
    createdAt: "2025-01-15T12:00:00.000Z",
  },
};

const periodObligation = {
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
  installments: [installment],
  shiftMemberships: [],
  summary: { total: "2000000.00", paid: "500000.00", balance: "1500000.00", status: "pending" },
};

const groupObligation = {
  id: "ob-group",
  employeeId: "emp-2",
  kind: "SHIFT_GROUP",
  status: "PENDING",
  version: 0,
  periodStart: null,
  periodEnd: null,
  periodAmount: null,
  expenseEnabled: false,
  selectedExpenseDate: null,
  createdAt: "2025-01-02T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
  installments: [],
  shiftMemberships: [
    {
      id: "member-1",
      shiftId: "shift-used",
      releasedAt: null,
      shift: { id: "shift-used", date: "2025-01-05T00:00:00.000Z", kind: "FULL_DAY", amount: "300000.00" },
    },
  ],
  summary: { total: "9999999999.99", paid: "0.00", balance: "9999999999.99", status: "pending" },
};

const shifts = [
  { id: "shift-used", employeeId: "emp-1", date: "2025-01-05T00:00:00.000Z", kind: "FULL_DAY", amount: "300000.00", observation: null },
  { id: "shift-free", employeeId: "emp-1", date: "2025-01-06T00:00:00.000Z", kind: "PARTIAL_DAY", amount: "150000.00", observation: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.obligationsEnabled = null;
  state.obligations = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  state.employees = { data: employees };
  state.shifts = { data: shifts, isLoading: false, isError: false };
  state.createPeriod = vi.fn().mockResolvedValue({});
  state.createGroup = vi.fn().mockResolvedValue({});
  state.createPeriodInstallment = vi.fn().mockResolvedValue({});
  state.createGroupInstallment = vi.fn().mockResolvedValue({});
  state.correctPeriodInstallment = vi.fn().mockResolvedValue({});
  state.createCashReturn = vi.fn().mockResolvedValue({});
  state.createReplacement = vi.fn().mockResolvedValue({});
});

afterEach(cleanup);

// The card hosts one overflow menu per payment; opening it is the only access
// path to the actions the payment allows in its current state.
async function openActions(user: UserEvent, employee: string) {
  await user.click(screen.getByRole("button", { name: `Acciones de ${employee}` }));
}

// A dialog focuses its first field immediately and again on the next frame, so a
// test that starts typing as soon as the dialog appears waits that frame out
// first instead of racing the second focus pass.
async function settleDialogFocus() {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

it("shows loading, error and empty states", () => {
  state.obligations.isLoading = true;
  const view = render(<PayrollPage />);
  expect(screen.getByText("Cargando pagos de nómina...")).toBeInTheDocument();

  state.obligations.isLoading = false;
  state.obligations.isError = true;
  view.rerender(<PayrollPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los pagos");

  state.obligations.isError = false;
  view.rerender(<PayrollPage />);
  expect(screen.getByText("No hay pagos registrados")).toBeInTheDocument();
});

it("renders the server summary and cash history exactly as the API returned them", () => {
  state.obligations.data = [periodObligation, groupObligation];
  render(<PayrollPage />);

  // Names come from the employee directory, not from a re-price of the payment.
  expect(screen.getByRole("heading", { name: "Ana Gómez" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Luis Prado" })).toBeInTheDocument();

  // The stored cash row says 111.111,00 and the server summary says 500.000,00.
  // The screen must show the server value.
  expect(screen.getByTestId("summary-paid-ob-period")).toHaveTextContent("$ 500.000,00");
  expect(screen.getByTestId("summary-total-ob-period")).toHaveTextContent("$ 2.000.000,00");
  expect(screen.getByTestId("summary-balance-ob-period")).toHaveTextContent("$ 1.500.000,00");
  expect(screen.getByTestId("summary-balance-ob-group")).toHaveTextContent("$ 9.999.999.999,99");

  // Installment history keeps the real date, method and amount.
  expect(screen.getByText("15 de enero de 2025 · Efectivo · $ 111.111,00")).toBeInTheDocument();
  expect(screen.getByText("Sin abonos")).toBeInTheDocument();
  expect(screen.getByText(/Gasto al completar: Sí · 1 de febrero de 2025/)).toBeInTheDocument();
  expect(screen.getByText(/Gasto al completar: No/)).toBeInTheDocument();
});

it("creates a fixed-period payment carrying the per-payment expense choice", async () => {
  const user = userEvent.setup();
  render(<PayrollPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo pago" }));

  const dialog = screen.getByRole("dialog", { name: "Nuevo pago fijo" });
  await settleDialogFocus();
  await user.selectOptions(within(dialog).getByLabelText("Empleado"), "emp-1");
  await user.type(within(dialog).getByLabelText(/Fecha inicial/), "2025-02-01");
  await user.type(within(dialog).getByLabelText(/Fecha final/), "2025-02-28");
  await user.type(within(dialog).getByLabelText(/Monto del período/), "1500000.75");
  await user.click(within(dialog).getByLabelText("Generar gasto al completar el pago"));
  await user.type(within(dialog).getByLabelText("Fecha del gasto (opcional)"), "2025-03-01");
  await user.click(within(dialog).getByRole("button", { name: "Crear pago" }));

  await waitFor(() =>
    expect(state.createPeriod).toHaveBeenCalledWith({
      employeeId: "emp-1",
      periodStart: "2025-02-01",
      periodEnd: "2025-02-28",
      periodAmount: "1500000.75",
      expenseEnabled: true,
      selectedExpenseDate: "2025-03-01",
    }),
  );
});

it("sends an explicit no-expense choice when the toggle stays off", async () => {
  const user = userEvent.setup();
  render(<PayrollPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo pago" }));

  const dialog = screen.getByRole("dialog", { name: "Nuevo pago fijo" });
  await settleDialogFocus();
  await user.selectOptions(within(dialog).getByLabelText("Empleado"), "emp-2");
  await user.type(within(dialog).getByLabelText(/Fecha inicial/), "2025-02-01");
  await user.type(within(dialog).getByLabelText(/Fecha final/), "2025-02-28");
  await user.type(within(dialog).getByLabelText(/Monto del período/), "10");
  await user.click(within(dialog).getByRole("button", { name: "Crear pago" }));

  await waitFor(() =>
    expect(state.createPeriod).toHaveBeenCalledWith({
      employeeId: "emp-2",
      periodStart: "2025-02-01",
      periodEnd: "2025-02-28",
      periodAmount: "10",
      expenseEnabled: false,
    }),
  );
  expect(within(dialog).queryByLabelText("Fecha del gasto (opcional)")).not.toBeInTheDocument();
});

it("groups only the shifts that are not already owned by a payment", async () => {
  const user = userEvent.setup();
  state.obligations.data = [groupObligation];
  render(<PayrollPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo pago" }));

  let dialog = screen.getByRole("dialog", { name: "Nuevo pago fijo" });
  await settleDialogFocus();
  // One entry point with a kind switch instead of two competing buttons.
  await user.click(within(dialog).getByRole("button", { name: "Por jornadas" }));
  dialog = screen.getByRole("dialog", { name: "Nuevo pago por jornadas" });
  await settleDialogFocus();
  await user.selectOptions(within(dialog).getByLabelText("Empleado"), "emp-1");

  const freeShift = within(dialog).getByRole("checkbox", { name: /6 de enero de 2025 · Día parcial/ });
  expect(freeShift).toBeInTheDocument();
  expect(within(dialog).queryByRole("checkbox", { name: /5 de enero de 2025/ })).not.toBeInTheDocument();

  await user.click(freeShift);
  await user.click(within(dialog).getByRole("button", { name: "Crear pago" }));

  await waitFor(() =>
    expect(state.createGroup).toHaveBeenCalledWith({
      employeeId: "emp-1",
      shiftIds: ["shift-free"],
      expenseEnabled: false,
    }),
  );
});

it("registers an installment on the endpoint that matches the obligation kind", async () => {
  const user = userEvent.setup();
  state.obligations.data = [periodObligation, groupObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Registrar abono" }));
  let dialog = screen.getByRole("dialog", { name: "Registrar abono" });
  await settleDialogFocus();
  await user.type(within(dialog).getByLabelText(/Monto del abono/), "500000.75");
  await user.type(within(dialog).getByLabelText(/Fecha del abono/), "2025-01-20");
  await user.selectOptions(within(dialog).getByLabelText("Método de pago"), "TRANSFER");
  await user.click(within(dialog).getByRole("button", { name: "Guardar abono" }));

  await waitFor(() =>
    expect(state.createPeriodInstallment).toHaveBeenCalledWith({
      employeeId: "emp-1",
      obligationId: "ob-period",
      amount: "500000.75",
      date: "2025-01-20",
      method: "TRANSFER",
    }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await openActions(user, "Luis Prado");
  await user.click(screen.getByRole("menuitem", { name: "Registrar abono" }));
  dialog = screen.getByRole("dialog", { name: "Registrar abono" });
  await settleDialogFocus();
  await user.type(within(dialog).getByLabelText(/Monto del abono/), "100000");
  await user.type(within(dialog).getByLabelText(/Fecha del abono/), "2025-01-21");
  await user.click(within(dialog).getByRole("button", { name: "Guardar abono" }));

  await waitFor(() =>
    expect(state.createGroupInstallment).toHaveBeenCalledWith({
      employeeId: "emp-2",
      obligationId: "ob-group",
      amount: "100000",
      date: "2025-01-21",
      method: "CASH",
    }),
  );
  expect(state.createPeriodInstallment).toHaveBeenCalledTimes(1);
});

it("shows the approved expense limit and inactive category messages instead of failing silently", async () => {
  const user = userEvent.setup();
  const limitError = Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: {
      data: {
        message:
          "El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto",
      },
    },
  });
  const inactiveError = Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: {
      data: {
        message:
          "La categoría de gasto de nómina está inactiva; requiere reactivación explícita",
      },
    },
  });
  state.createPeriodInstallment = vi
    .fn()
    .mockRejectedValueOnce(limitError)
    .mockRejectedValueOnce(inactiveError);
  state.obligations.data = [periodObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Registrar abono" }));
  const dialog = screen.getByRole("dialog", { name: "Registrar abono" });
  await settleDialogFocus();
  await user.type(within(dialog).getByLabelText(/Monto del abono/), "10");
  await user.type(within(dialog).getByLabelText(/Fecha del abono/), "2025-01-20");
  await user.click(within(dialog).getByRole("button", { name: "Guardar abono" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "El gasto de nómina supera $9.999.999.999,99; el pago no se puede completar con gasto",
  );
  // The dialog stays open so the rejected payment can be corrected.
  expect(screen.getByRole("dialog", { name: "Registrar abono" })).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "Guardar abono" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "La categoría de gasto de nómina está inactiva; requiere reactivación explícita",
  );
});

it("offers no installment on a payment the server reports as completed", async () => {
  const user = userEvent.setup();
  state.obligations.data = [
    {
      ...periodObligation,
      status: "COMPLETED",
      summary: { total: "2000000.00", paid: "2000000.00", balance: "0.00", status: "completed" },
    },
  ];
  render(<PayrollPage />);

  expect(screen.getByTestId("summary-balance-ob-period")).toHaveTextContent("$ 0,00");
  await openActions(user, "Ana Gómez");
  expect(screen.queryByRole("menuitem", { name: "Registrar abono" })).not.toBeInTheDocument();
});

it("requires at least one shift before creating a group payment", async () => {
  const user = userEvent.setup();
  render(<PayrollPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo pago" }));

  let dialog = screen.getByRole("dialog", { name: "Nuevo pago fijo" });
  await settleDialogFocus();
  await user.click(within(dialog).getByRole("button", { name: "Por jornadas" }));
  dialog = screen.getByRole("dialog", { name: "Nuevo pago por jornadas" });
  await settleDialogFocus();
  await user.selectOptions(within(dialog).getByLabelText("Empleado"), "emp-1");
  await user.click(within(dialog).getByRole("button", { name: "Crear pago" }));

  expect(within(dialog).getByRole("alert")).toHaveTextContent("Selecciona al menos una jornada");
  expect(state.createGroup).not.toHaveBeenCalled();
});

it("corrects a wrongly recorded installment without resending its date, method or expense choice", async () => {
  const user = userEvent.setup();
  const secondInstallment = {
    id: "inst-2",
    outflowId: "out-2",
    createdAt: "2025-01-25T12:00:00.000Z",
    outflow: {
      id: "out-2",
      amount: "30000.00",
      date: "2025-01-25T00:00:00.000Z",
      method: "TRANSFER",
      createdAt: "2025-01-25T12:00:00.000Z",
    },
  };
  state.obligations.data = [
    { ...periodObligation, installments: [installment, secondInstallment] },
  ];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Corregir abono" }));
  const dialog = screen.getByRole("dialog", { name: "Corregir abono" });
  await settleDialogFocus();

  // The wrongly recorded cash row is shown read-only: the correction never picks
  // a new date or method, and the server decides the expense date.
  expect(within(dialog).getByTestId("correction-current-amount")).toHaveTextContent("$ 111.111,00");
  expect(within(dialog).getByTestId("correction-current-date")).toHaveTextContent("15 de enero de 2025");
  expect(within(dialog).queryByLabelText(/Fecha/)).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText(/Método/)).not.toBeInTheDocument();

  await user.selectOptions(within(dialog).getByLabelText("Abono a corregir"), "inst-2");
  expect(within(dialog).getByTestId("correction-current-amount")).toHaveTextContent("$ 30.000,00");
  expect(within(dialog).getByTestId("correction-current-date")).toHaveTextContent("25 de enero de 2025");

  // The typed decimal is sent exactly as the field holds it; the backend accepts
  // 1-2 decimal places.
  await user.type(within(dialog).getByLabelText(/Importe corregido/), "180000.5");
  await user.click(within(dialog).getByRole("button", { name: "Guardar corrección" }));

  await waitFor(() =>
    expect(state.correctPeriodInstallment).toHaveBeenCalledWith({
      employeeId: "emp-1",
      obligationId: "ob-period",
      installmentId: "inst-2",
      amount: "180000.5",
    }),
  );
  // The corrected row keeps its stored date and method and gains no expense date.
  expect(state.correctPeriodInstallment).toHaveBeenCalledWith(
    expect.not.objectContaining({ date: expect.anything() }),
  );
  expect(state.correctPeriodInstallment).toHaveBeenCalledWith(
    expect.not.objectContaining({ method: expect.anything() }),
  );
  expect(state.correctPeriodInstallment).toHaveBeenCalledWith(
    expect.not.objectContaining({ selectedExpenseDate: expect.anything() }),
  );
  // A correction is its own route: it must not look like a new abono.
  expect(state.createPeriodInstallment).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("corrects the installment of the payment whose dialog was opened", async () => {
  const user = userEvent.setup();
  state.obligations.data = [
    periodObligation,
    {
      ...periodObligation,
      id: "ob-other",
      employeeId: "emp-2",
      installments: [
        {
          ...installment,
          id: "inst-other",
          outflowId: "out-other",
          outflow: { ...installment.outflow, id: "out-other", amount: "70000.00", date: "2025-01-09T00:00:00.000Z" },
        },
      ],
    },
  ];
  render(<PayrollPage />);

  await openActions(user, "Luis Prado");
  await user.click(screen.getByRole("menuitem", { name: "Corregir abono" }));
  const dialog = screen.getByRole("dialog", { name: "Corregir abono" });
  await settleDialogFocus();
  expect(within(dialog).getByTestId("correction-current-amount")).toHaveTextContent("$ 70.000,00");
  expect(within(dialog).getByTestId("correction-current-date")).toHaveTextContent("9 de enero de 2025");

  await user.type(within(dialog).getByLabelText(/Importe corregido/), "90000");
  await user.click(within(dialog).getByRole("button", { name: "Guardar corrección" }));

  await waitFor(() =>
    expect(state.correctPeriodInstallment).toHaveBeenCalledWith({
      employeeId: "emp-2",
      obligationId: "ob-other",
      installmentId: "inst-other",
      amount: "90000",
    }),
  );
});

it("describes the correction as an amount fix that may still complete the payment", async () => {
  const user = userEvent.setup();
  state.obligations.data = [periodObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Corregir abono" }));
  const dialog = screen.getByRole("dialog", { name: "Corregir abono" });
  await settleDialogFocus();

  expect(dialog).toHaveTextContent(
    "El movimiento de caja conserva su fecha y su método de pago; la fecha del gasto la decide el servidor.",
  );
  // A correction that reaches the exact outstanding total completes the payment,
  // so the dialog must not promise the payment stays pending.
  expect(dialog).toHaveTextContent(
    "Si el importe corregido iguala el saldo pendiente, el pago se completa y se aplica la opción de gasto elegida.",
  );
});

it("surfaces the correction error verbatim and keeps the dialog open", async () => {
  const user = userEvent.setup();
  state.correctPeriodInstallment = vi.fn().mockRejectedValue(
    Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { data: { message: "Corrección excede el saldo disponible" } },
    }),
  );
  state.obligations.data = [periodObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Corregir abono" }));
  const dialog = screen.getByRole("dialog", { name: "Corregir abono" });
  await settleDialogFocus();
  await user.type(within(dialog).getByLabelText(/Importe corregido/), "9999999");
  await user.click(within(dialog).getByRole("button", { name: "Guardar corrección" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Corrección excede el saldo disponible",
  );
  expect(screen.getByRole("dialog", { name: "Corregir abono" })).toBeInTheDocument();
});

it("offers no correction on a completed payment or on a shift-group payment", async () => {
  const user = userEvent.setup();
  state.obligations.data = [
    {
      ...periodObligation,
      status: "COMPLETED",
      summary: { total: "2000000.00", paid: "2000000.00", balance: "0.00", status: "completed" },
    },
    groupObligation,
  ];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  expect(screen.queryByRole("menuitem", { name: "Corregir abono" })).not.toBeInTheDocument();
  // The correction route only exists for fixed-period installments.
  await openActions(user, "Luis Prado");
  expect(screen.queryByRole("menuitem", { name: "Corregir abono" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Registrar abono" })).toBeInTheDocument();
});

it("offers no correction while the payment has no installment to fix", async () => {
  const user = userEvent.setup();
  state.obligations.data = [{ ...periodObligation, installments: [] }];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  expect(screen.queryByRole("menuitem", { name: "Corregir abono" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Registrar abono" })).toBeInTheDocument();
});

it("does not expose payroll to roles other than OWNER and ADMIN", () => {
  state.role = "CASHIER";
  state.obligations.data = [periodObligation];
  render(<PayrollPage />);

  expect(state.obligationsEnabled).toBe(false);
  expect(screen.queryByRole("button", { name: "Nuevo pago" })).not.toBeInTheDocument();
  expect(screen.queryByText("Ana Gómez")).not.toBeInTheDocument();
  // A forbidden role reads why, instead of an empty page.
  expect(screen.getByText("No tienes acceso a la nómina")).toBeInTheDocument();
});

// S7/S8: a real return covers exactly one complete installment (L329), is
// reflected on the day the money came back (L325) and by the real method it came
// back by (L330). The amount is never typed: it is the stored installment.
const completedPeriodObligation = {
  ...periodObligation,
  status: "COMPLETED",
  summary: { total: "2000000.00", paid: "2000000.00", balance: "0.00", status: "completed" },
};

const unreturnedInstallment = {
  id: "inst-2",
  outflowId: "out-2",
  createdAt: "2025-01-25T12:00:00.000Z",
  outflow: {
    id: "out-2",
    amount: "30000.00",
    date: "2025-01-25T00:00:00.000Z",
    method: "TRANSFER",
    createdAt: "2025-01-25T12:00:00.000Z",
  },
};

const returnedInstallment = {
  ...installment,
  cashReturn: {
    id: "ret-1",
    amount: "111111.00",
    returnDate: "2025-01-20T00:00:00.000Z",
    returnMethod: "CARD",
  },
};

// The dialog defaults to today in Bogotá, computed independently of the helper
// the page uses so a wrong default cannot pass by sharing the same code.
const bogotaToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

it("offers no return while the payment is still pending", async () => {
  const user = userEvent.setup();
  state.obligations.data = [periodObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  expect(screen.queryByRole("menuitem", { name: /Registrar devolución/ })).not.toBeInTheDocument();
  // A pending payment keeps its abono and correction actions instead.
  expect(screen.getByRole("menuitem", { name: "Registrar abono" })).toBeInTheDocument();
});

it("offers a return only on a completed installment that has no return yet", async () => {
  const user = userEvent.setup();
  state.obligations.data = [
    { ...completedPeriodObligation, installments: [returnedInstallment, unreturnedInstallment] },
  ];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  expect(
    screen.getByRole("menuitem", { name: /Registrar devolución · 25 de enero de 2025/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: /Registrar devolución · 15 de enero de 2025/ }),
  ).not.toBeInTheDocument();
  // A completed payment takes no new abono and no correction.
  expect(screen.queryByRole("menuitem", { name: "Registrar abono" })).not.toBeInTheDocument();
});

it("records the real return date and method without sending the amount", async () => {
  const user = userEvent.setup();
  state.obligations.data = [completedPeriodObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(
    screen.getByRole("menuitem", { name: /Registrar devolución · 15 de enero de 2025/ }),
  );
  const dialog = screen.getByRole("dialog", { name: "Registrar devolución" });
  await settleDialogFocus();

  // The returned amount comes from the stored installment and is not editable.
  expect(within(dialog).getByTestId("cash-return-amount")).toHaveTextContent("$ 111.111,00");
  expect(within(dialog).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText(/Fecha de la devolución/)).toHaveValue(bogotaToday);

  await user.selectOptions(within(dialog).getByLabelText("Método de la devolución"), "CARD");
  await user.click(within(dialog).getByRole("button", { name: "Guardar devolución" }));

  await waitFor(() =>
    expect(state.createCashReturn).toHaveBeenCalledWith({
      employeeId: "emp-1",
      obligationId: "ob-period",
      installmentId: "inst-1",
      returnDate: bogotaToday,
      returnMethod: "CARD",
    }),
  );
  expect(state.createCashReturn).toHaveBeenCalledWith(
    expect.not.objectContaining({ amount: expect.anything() }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("keeps the server error visible when the return is refused", async () => {
  const user = userEvent.setup();
  state.createCashReturn = vi.fn().mockRejectedValue(
    Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { data: { message: "El abono ya tiene una devolución registrada" } },
    }),
  );
  state.obligations.data = [completedPeriodObligation];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(
    screen.getByRole("menuitem", { name: /Registrar devolución · 15 de enero de 2025/ }),
  );
  const dialog = screen.getByRole("dialog", { name: "Registrar devolución" });
  await settleDialogFocus();
  await user.click(within(dialog).getByRole("button", { name: "Guardar devolución" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "El abono ya tiene una devolución registrada",
  );
  // The dialog stays open on the same installment so the refusal is readable.
  expect(screen.getByRole("dialog", { name: "Registrar devolución" })).toBeInTheDocument();
  expect(screen.queryByText(/Devolución registrada/)).not.toBeInTheDocument();
});

it("shows a returned installment as returned and offers no second return", async () => {
  const user = userEvent.setup();
  state.obligations.data = [{ ...completedPeriodObligation, installments: [returnedInstallment] }];
  render(<PayrollPage />);

  expect(screen.getByText("Devuelto el 20 de enero de 2025 · Tarjeta")).toBeInTheDocument();
  await openActions(user, "Ana Gómez");
  expect(screen.queryByRole("menuitem", { name: /Registrar devolución/ })).not.toBeInTheDocument();
});

// S6/S7 (L327, L338): a replacement is a NEW payment that references the valid
// installments of a COMPLETED one, so the completed payment and its expense stay
// untouched and no amount is ever typed or sent.
const completedForReplacement = {
  ...periodObligation,
  status: "COMPLETED",
  installments: [installment, unreturnedInstallment],
  summary: { total: "141111.00", paid: "141111.00", balance: "0.00", status: "completed" },
};

it("offers no replacement while the payment is still pending", async () => {
  const user = userEvent.setup();
  state.obligations.data = [periodObligation];
  const view = render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  expect(screen.queryByRole("menuitem", { name: "Reemplazar pago" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Registrar abono" })).toBeInTheDocument();
  await user.keyboard("{Escape}");

  // Only the completed payment can be replaced; the pending one keeps its own
  // actions and never shows the replacement entry point.
  state.obligations.data = [completedForReplacement];
  view.rerender(<PayrollPage />);
  await openActions(user, "Ana Gómez");
  expect(screen.getByRole("menuitem", { name: "Reemplazar pago" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Registrar abono" })).not.toBeInTheDocument();
});

it("changes the referenced total when the installment selection changes", async () => {
  const user = userEvent.setup();
  state.obligations.data = [completedForReplacement];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Reemplazar pago" }));
  const dialog = screen.getByRole("dialog", { name: "Reemplazar pago completado" });
  await settleDialogFocus();

  const firstInstallment = within(dialog).getByRole("checkbox", { name: /15 de enero de 2025/ });
  const secondInstallment = within(dialog).getByRole("checkbox", { name: /25 de enero de 2025/ });
  // Every installment of the completed payment starts selected.
  expect(firstInstallment).toBeChecked();
  expect(secondInstallment).toBeChecked();

  // The total of the payment is the server value and never a client re-derivation;
  // the referenced total and the balance follow the selection.
  expect(within(dialog).getByTestId("replacement-source-total")).toHaveTextContent("$ 141.111,00");
  expect(within(dialog).getByTestId("replacement-referenced-total")).toHaveTextContent("$ 141.111,00");
  expect(within(dialog).getByTestId("replacement-balance-total")).toHaveTextContent("$ 0,00");

  await user.click(secondInstallment);

  expect(firstInstallment).toBeChecked();
  expect(secondInstallment).not.toBeChecked();
  expect(within(dialog).getByTestId("replacement-referenced-total")).toHaveTextContent("$ 111.111,00");
  expect(within(dialog).getByTestId("replacement-balance-total")).toHaveTextContent("$ 30.000,00");
  expect(within(dialog).getByTestId("replacement-source-total")).toHaveTextContent("$ 141.111,00");
});

it("sends the seven replacement fields and never an amount", async () => {
  const user = userEvent.setup();
  state.obligations.data = [completedForReplacement];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Reemplazar pago" }));
  const dialog = screen.getByRole("dialog", { name: "Reemplazar pago completado" });
  await settleDialogFocus();

  // The new payment starts with the dates of the payment it replaces, and the
  // actor may state others.
  const periodStart = within(dialog).getByLabelText(/Fecha inicial del nuevo pago/);
  const periodEnd = within(dialog).getByLabelText(/Fecha final del nuevo pago/);
  expect(periodStart).toHaveValue("2025-01-01");
  expect(periodEnd).toHaveValue("2025-01-31");
  await user.clear(periodStart);
  await user.type(periodStart, "2025-02-01");
  await user.clear(periodEnd);
  await user.type(periodEnd, "2025-02-28");

  // The wrongly recorded installment stays behind as the balance still to pay.
  await user.click(within(dialog).getByRole("checkbox", { name: /25 de enero de 2025/ }));

  await user.click(within(dialog).getByLabelText("Generar gasto al completar el pago"));
  await user.type(within(dialog).getByLabelText("Fecha del gasto (opcional)"), "2025-03-01");
  await user.click(within(dialog).getByRole("button", { name: "Crear pago de reemplazo" }));

  await waitFor(() =>
    expect(state.createReplacement).toHaveBeenCalledWith({
      employeeId: "emp-1",
      sourceObligationId: "ob-period",
      installmentIds: ["inst-1"],
      periodStart: "2025-02-01",
      periodEnd: "2025-02-28",
      expenseEnabled: true,
      selectedExpenseDate: "2025-03-01",
    }),
  );

  // Exactly those seven fields: the corrected amount stays server-owned. The
  // hoisted mutation is typed as unknown at the mock boundary, so it is narrowed
  // once to the call contract this assertion reads.
  type ReplacementCall = { mock: { calls: [Record<string, unknown>][] } };
  const replacementMock = state.createReplacement as unknown as ReplacementCall;
  const submitted = replacementMock.mock.calls[0][0];
  expect(Object.keys(submitted).sort()).toEqual(
    [
      "employeeId",
      "expenseEnabled",
      "installmentIds",
      "periodEnd",
      "periodStart",
      "selectedExpenseDate",
      "sourceObligationId",
    ].sort(),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("keeps the server refusal of a replacement visible with the dialog open", async () => {
  const user = userEvent.setup();
  state.createReplacement = vi.fn().mockRejectedValue(
    Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { data: { message: "Los abonos referenciados cubren el pago completo" } },
    }),
  );
  state.obligations.data = [completedForReplacement];
  render(<PayrollPage />);

  await openActions(user, "Ana Gómez");
  await user.click(screen.getByRole("menuitem", { name: "Reemplazar pago" }));
  const dialog = screen.getByRole("dialog", { name: "Reemplazar pago completado" });
  await settleDialogFocus();
  await user.click(within(dialog).getByRole("button", { name: "Crear pago de reemplazo" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Los abonos referenciados cubren el pago completo",
  );
  // The dialog stays open on the same payment so the refusal can be read and the
  // selection corrected.
  expect(screen.getByRole("dialog", { name: "Reemplazar pago completado" })).toBeInTheDocument();
  expect(screen.queryByText(/Pago de reemplazo creado/)).not.toBeInTheDocument();
});
