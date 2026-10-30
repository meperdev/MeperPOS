import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});

afterEach(cleanup);

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
  expect(screen.getByText("2025-01-15 · Efectivo · $ 111.111,00")).toBeInTheDocument();
  expect(screen.getByText("Sin abonos")).toBeInTheDocument();
  expect(screen.getByText(/Gasto al completar: Sí · 2025-02-01/)).toBeInTheDocument();
  expect(screen.getByText(/Gasto al completar: No/)).toBeInTheDocument();
});

it("creates a fixed-period payment carrying the per-payment expense choice", async () => {
  const user = userEvent.setup();
  render(<PayrollPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo pago fijo" }));

  const dialog = screen.getByRole("dialog", { name: "Nuevo pago fijo" });
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
  await user.click(screen.getByRole("button", { name: "Nuevo pago fijo" }));

  const dialog = screen.getByRole("dialog", { name: "Nuevo pago fijo" });
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
  await user.click(screen.getByRole("button", { name: "Nuevo pago por jornadas" }));

  const dialog = screen.getByRole("dialog", { name: "Nuevo pago por jornadas" });
  await user.selectOptions(within(dialog).getByLabelText("Empleado"), "emp-1");

  expect(within(dialog).getByLabelText("Jornada 2025-01-06")).toBeInTheDocument();
  expect(within(dialog).queryByLabelText("Jornada 2025-01-05")).not.toBeInTheDocument();

  await user.click(within(dialog).getByLabelText("Jornada 2025-01-06"));
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

  await user.click(screen.getByRole("button", { name: "Registrar abono Ana Gómez" }));
  let dialog = screen.getByRole("dialog", { name: "Registrar abono" });
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
  await user.click(screen.getByRole("button", { name: "Registrar abono Luis Prado" }));
  dialog = screen.getByRole("dialog", { name: "Registrar abono" });
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

  await user.click(screen.getByRole("button", { name: "Registrar abono Ana Gómez" }));
  const dialog = screen.getByRole("dialog", { name: "Registrar abono" });
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

it("offers no installment on a payment the server reports as completed", () => {
  state.obligations.data = [
    {
      ...periodObligation,
      status: "COMPLETED",
      summary: { total: "2000000.00", paid: "2000000.00", balance: "0.00", status: "completed" },
    },
  ];
  render(<PayrollPage />);

  expect(screen.getByTestId("summary-balance-ob-period")).toHaveTextContent("$ 0,00");
  expect(screen.queryByRole("button", { name: "Registrar abono Ana Gómez" })).not.toBeInTheDocument();
});

it("requires at least one shift before creating a group payment", async () => {
  const user = userEvent.setup();
  render(<PayrollPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo pago por jornadas" }));

  const dialog = screen.getByRole("dialog", { name: "Nuevo pago por jornadas" });
  await user.selectOptions(within(dialog).getByLabelText("Empleado"), "emp-1");
  await user.click(within(dialog).getByRole("button", { name: "Crear pago" }));

  expect(within(dialog).getByRole("alert")).toHaveTextContent("Selecciona al menos una jornada");
  expect(state.createGroup).not.toHaveBeenCalled();
});

it("does not expose payroll to roles other than OWNER and ADMIN", () => {
  state.role = "CASHIER";
  state.obligations.data = [periodObligation];
  render(<PayrollPage />);

  expect(state.obligationsEnabled).toBe(false);
  expect(screen.queryByRole("button", { name: "Nuevo pago fijo" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nuevo pago por jornadas" })).not.toBeInTheDocument();
  expect(screen.queryByText("Ana Gómez")).not.toBeInTheDocument();
});
