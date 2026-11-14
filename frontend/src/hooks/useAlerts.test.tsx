import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type AuthSnapshot = {
  user: { role: string };
  organization: {
    id: string;
    status: string;
    trialEndsAt: string | null;
  };
};

type LimitsSnapshot = {
  limits: Array<{
    type: string;
    current: number;
    limit: number;
    exceeded: boolean;
    warningAt: number;
  }>;
};

const authState = vi.hoisted(() => ({
  current: { user: { role: "ADMIN" }, organization: { id: "org-1", status: "ACTIVE", trialEndsAt: null } } as AuthSnapshot,
}));
const planState = vi.hoisted(() => ({ current: undefined as LimitsSnapshot | undefined }));
const stockState = vi.hoisted(() => ({ current: undefined as Array<{ stock: number }> | undefined }));
const loanState = vi.hoisted(() => ({
  current: undefined as { data: Array<{ status: string; dueAt: string | null }> } | undefined,
}));
const taskState = vi.hoisted(() => ({
  current: undefined as { tasks: Array<{ status: string; dueDate: string | null }> } | undefined,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState.current }));
vi.mock("@/hooks/usePlanLimits", () => ({ usePlanLimits: () => ({ data: planState.current }) }));
vi.mock("@/hooks/useProducts", () => ({ useLowStockProducts: () => ({ data: stockState.current }) }));
vi.mock("@/hooks/useLoans", () => ({ useLoans: () => ({ data: loanState.current }) }));
vi.mock("@/hooks/useTasks", () => ({ useTasks: () => ({ data: taskState.current }) }));

import { useAlerts } from "./useAlerts";

const past = "2020-01-01T00:00:00.000Z";

describe("useAlerts", () => {
  beforeEach(() => {
    authState.current = {
      user: { role: "ADMIN" },
      organization: { id: "org-1", status: "ACTIVE", trialEndsAt: null },
    };
    planState.current = undefined;
    stockState.current = undefined;
    loanState.current = undefined;
    taskState.current = undefined;
  });

  it("derives the five alert sources, sorted by severity", () => {
    authState.current.organization.status = "PAST_DUE";
    planState.current = {
      limits: [
        { type: "products", current: 12, limit: 10, exceeded: true, warningAt: 8 },
      ],
    };
    stockState.current = [{ stock: 0 }, { stock: 2 }];
    loanState.current = { data: [{ status: "OPEN", dueAt: past }] };
    taskState.current = { tasks: [{ status: "PENDING", dueDate: past }] };

    const { result } = renderHook(() => useAlerts());

    expect(result.current.map((alert) => alert.id)).toEqual([
      "billing:past-due",
      "limits:products:exceeded",
      "stock:depleted",
      "loans:overdue",
      "tasks:overdue",
    ]);
  });

  it("keeps billing, limits and stock away from a cashier", () => {
    authState.current = {
      user: { role: "CASHIER" },
      organization: { id: "org-1", status: "PAST_DUE", trialEndsAt: null },
    };
    planState.current = {
      limits: [
        { type: "products", current: 12, limit: 10, exceeded: true, warningAt: 8 },
      ],
    };
    stockState.current = [{ stock: 0 }];
    loanState.current = { data: [{ status: "OPEN", dueAt: past }] };
    taskState.current = { tasks: [{ status: "PENDING", dueDate: past }] };

    const { result } = renderHook(() => useAlerts());

    expect(result.current.map((alert) => alert.id)).toEqual([
      "loans:overdue",
      "tasks:overdue",
    ]);
  });

  it("treats reaching a limit as no capacity left, not a violation", () => {
    planState.current = {
      limits: [
        { type: "users", current: 3, limit: 3, exceeded: true, warningAt: 2 },
      ],
    };

    const { result } = renderHook(() => useAlerts());

    expect(result.current).toEqual([
      expect.objectContaining({
        id: "limits:users:at-limit",
        severity: "warning",
        title: "Alcanzaste el límite de usuarios",
      }),
    ]);
  });

  it("escalates to a critical alert once the limit is actually surpassed", () => {
    planState.current = {
      limits: [
        { type: "users", current: 4, limit: 3, exceeded: true, warningAt: 2 },
      ],
    };

    const { result } = renderHook(() => useAlerts());

    expect(result.current[0]).toMatchObject({
      id: "limits:users:exceeded",
      severity: "critical",
      title: "Límite de usuarios excedido",
    });
  });

  it("reports the remaining trial days with the matching severity", () => {
    authState.current.organization.status = "TRIAL";
    // The shared clock ticks per minute, so pin the target just inside the day.
    authState.current.organization.trialEndsAt = new Date(
      Date.now() + 5 * 86_400_000 - 60_000,
    ).toISOString();

    const { result } = renderHook(() => useAlerts());

    expect(result.current[0]).toMatchObject({
      id: "billing:trial",
      severity: "info",
      title: "Tu prueba termina en 5 días",
    });
  });

  it("escalates the trial warning inside the last three days", () => {
    authState.current.organization.status = "TRIAL";
    authState.current.organization.trialEndsAt = new Date(
      Date.now() + 2 * 86_400_000 - 60_000,
    ).toISOString();

    const { result } = renderHook(() => useAlerts());

    expect(result.current[0]).toMatchObject({
      id: "billing:trial",
      severity: "warning",
    });
  });
});
