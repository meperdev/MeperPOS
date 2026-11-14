import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

type AlertFixture = {
  id: string;
  category: "billing" | "limits" | "stock" | "loans" | "tasks";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
};

const alertsState = vi.hoisted(() => ({ current: [] as AlertFixture[] }));

vi.mock("@/hooks/useAlerts", () => ({ useAlerts: () => alertsState.current }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { organizationId: "org-1" },
    organization: { id: "org-1" },
  }),
}));

import { AlertCenter } from "./AlertCenter";

const twoAlerts: AlertFixture[] = [
  {
    id: "billing:past-due",
    category: "billing",
    severity: "critical",
    title: "Suscripción vencida",
    detail: "Regulariza el pago.",
    href: "/settings/billing",
  },
  {
    id: "tasks:overdue",
    category: "tasks",
    severity: "warning",
    title: "2 tareas vencidas",
    detail: "Tienen fecha límite pasada.",
    href: "/tasks",
  },
];

describe("AlertCenter", () => {
  beforeEach(() => {
    localStorage.clear();
    alertsState.current = twoAlerts;
  });

  afterEach(cleanup);

  it("announces the unread count and lists the alerts", () => {
    render(<AlertCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    expect(screen.getByRole("dialog", { name: "Alertas" })).toBeInTheDocument();
    expect(screen.getByText("Suscripción vencida")).toBeInTheDocument();
    expect(screen.getByText("2 tareas vencidas")).toBeInTheDocument();
  });

  it("clears the badge and persists the ledger as soon as the panel opens", () => {
    render(<AlertCenter />);
    expect(screen.getByTestId("alert-badge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    expect(screen.getByRole("button", { name: "Alertas" })).toBeInTheDocument();
    expect(screen.queryByTestId("alert-badge")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("meperpos:alerts-seen:org-1") ?? "[]")).toEqual([
      "billing:past-due",
      "tasks:overdue",
    ]);
  });

  it("keeps the new dots for the visit that revealed them", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    expect(screen.getAllByTestId("alert-unread-dot")).toHaveLength(2);
  });

  it("closes the panel when following an alert", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));
    fireEvent.click(screen.getByRole("link", { name: /Suscripción vencida/ }));

    expect(screen.queryByRole("dialog", { name: "Alertas" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("meperpos:alerts-seen:org-1") ?? "[]")).toEqual([
      "billing:past-due",
      "tasks:overdue",
    ]);
  });

  it("shows the quiet empty state when nothing is pending", () => {
    alertsState.current = [];
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas" }));

    expect(screen.getByText("Todo en orden")).toBeInTheDocument();
  });
});
