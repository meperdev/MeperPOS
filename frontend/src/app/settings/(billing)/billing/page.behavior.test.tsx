import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { statusMock, limitsMock, paymentsMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  limitsMock: vi.fn(),
  paymentsMock: vi.fn(),
}));

const statusRefetchMock = vi.fn();
const limitsRefetchMock = vi.fn();
const paymentsRefetchMock = vi.fn();

vi.mock("@/hooks/useBilling", () => ({
  useBillingStatus: () => statusMock(),
  useBillingPayments: () => paymentsMock(),
  useRegisterPayment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
  usePlanLimits: () => limitsMock(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "u_1",
      name: "Admin",
      email: "admin@meper.app",
      role: "SUPER_ADMIN",
      active: true,
    },
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import BillingSettingsPage from "./page";

const statusData = {
  id: "org_1",
  plan: "PRO" as const,
  status: "ACTIVE" as const,
  trialEndsAt: null,
  billingStatus: "PAID" as const,
};

const limitsData = {
  organizationId: "org_1",
  limits: [
    { type: "users" as const, current: 2, limit: 5, exceeded: false, warningAt: 4 },
    { type: "products" as const, current: 3, limit: 10, exceeded: false, warningAt: 8 },
  ],
};

const paymentsData = [
  {
    id: "pay_1",
    organizationId: "org_1",
    amount: 1500000,
    method: "CASH" as const,
    date: "2026-01-15",
    status: "PAID" as const,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  },
];

type QueryState = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
};

const okState = (data: unknown): QueryState => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
});

const failedState = (): QueryState => ({
  data: undefined,
  isLoading: false,
  isError: true,
  error: new Error("Network error"),
});

function mockQueries(
  status: QueryState = okState(statusData),
  limits: QueryState = okState(limitsData),
  payments: QueryState = okState(paymentsData),
) {
  statusRefetchMock.mockReset();
  limitsRefetchMock.mockReset();
  paymentsRefetchMock.mockReset();
  statusMock.mockReturnValue({ ...status, refetch: statusRefetchMock });
  limitsMock.mockReturnValue({ ...limits, refetch: limitsRefetchMock });
  paymentsMock.mockReturnValue({ ...payments, refetch: paymentsRefetchMock });
}

describe("Billing settings page", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a full-page error when billing status fails, hiding plan/status defaults and the register form (S5)", async () => {
    mockQueries(failedState(), okState(limitsData), okState([]));
    render(<BillingSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar la información de facturación."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Básico")).toBeNull();
    expect(screen.queryByText("Activo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).toBeNull();
    expect(screen.queryByText("No hay pagos registrados.")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(statusRefetchMock).toHaveBeenCalled();
  });

  it("renders the authoritative plan and status returned by billing status (S6)", () => {
    mockQueries();
    render(<BillingSettingsPage />);

    expect(screen.getByText("Profesional")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Registrar pago" }),
    ).toBeInTheDocument();
  });

  it("shows a limits error card when only plan-limits fail while plan and payments still render (S9)", async () => {
    mockQueries(okState(statusData), failedState(), okState(paymentsData));
    render(<BillingSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar los límites del plan."),
    ).toBeInTheDocument();
    expect(screen.getByText("Uso y Límites")).toBeInTheDocument();
    expect(screen.getByText("Profesional")).toBeInTheDocument();
    expect(screen.getByText("Pagado")).toBeInTheDocument();
    expect(screen.queryByText("Usuarios")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(limitsRefetchMock).toHaveBeenCalled();
  });

  it("shows a payments error card when only payments fail while plan and limits still render (S10)", async () => {
    mockQueries(okState(statusData), okState(limitsData), failedState());
    render(<BillingSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar el historial de pagos."),
    ).toBeInTheDocument();
    expect(screen.getByText("Profesional")).toBeInTheDocument();
    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByText("Productos")).toBeInTheDocument();
    expect(screen.queryByText("No hay pagos registrados.")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(paymentsRefetchMock).toHaveBeenCalled();
  });

  it("never shows the empty-history message when the payments query failed (S7)", async () => {
    mockQueries(okState(statusData), okState(limitsData), failedState());
    render(<BillingSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar el historial de pagos."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay pagos registrados.")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(paymentsRefetchMock).toHaveBeenCalled();
  });

  it("keeps the empty-history message only when payments succeed with zero payments (S8)", () => {
    mockQueries(okState(statusData), okState(limitsData), okState([]));
    render(<BillingSettingsPage />);

    expect(screen.getByText("No hay pagos registrados.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers to the full page when a retried billing-status query succeeds", () => {
    mockQueries(failedState(), okState(limitsData), okState([]));
    const { rerender } = render(<BillingSettingsPage />);

    expect(
      screen.getByText("No se pudo cargar la información de facturación."),
    ).toBeInTheDocument();

    mockQueries(okState(statusData), okState(limitsData), okState([]));
    rerender(<BillingSettingsPage />);

    expect(
      screen.queryByText("No se pudo cargar la información de facturación."),
    ).toBeNull();
    expect(screen.getByText("Profesional")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });
});
