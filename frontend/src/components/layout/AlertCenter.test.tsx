import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

type AlertFixture = {
  id: string;
  category: "billing" | "limits" | "stock" | "loans" | "tasks";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  revision: string;
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
    revision: "rev-billing",
  },
  {
    id: "tasks:overdue",
    category: "tasks",
    severity: "warning",
    title: "2 tareas vencidas",
    detail: "Tienen fecha límite pasada.",
    href: "/tasks",
    revision: "rev-tasks",
  },
];

const ledger = () =>
  JSON.parse(localStorage.getItem("meperpos:alerts-seen:org-1") ?? "{}");

describe("AlertCenter", () => {
  beforeEach(() => {
    localStorage.clear();
    alertsState.current = twoAlerts;
  });

  afterEach(() => cleanup());

  it("announces the unread count and lists the alerts", () => {
    render(<AlertCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    expect(screen.getByRole("dialog", { name: "Alertas" })).toBeInTheDocument();
    expect(screen.getByText("Suscripción vencida")).toBeInTheDocument();
    expect(screen.getByText("2 tareas vencidas")).toBeInTheDocument();
  });

  it("clears the badge and persists the acknowledged revisions", () => {
    render(<AlertCenter />);
    expect(screen.getByTestId("alert-badge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    expect(screen.getByRole("button", { name: "Alertas" })).toBeInTheDocument();
    expect(screen.queryByTestId("alert-badge")).not.toBeInTheDocument();
    expect(ledger()).toEqual({
      "billing:past-due": "rev-billing",
      "tasks:overdue": "rev-tasks",
    });
  });

  it("rings again when the facts behind a seen alert change", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));
    cleanup();

    // Same alert ids; a new low-stock product changed the stock revision.
    alertsState.current = [
      { ...twoAlerts[0] },
      {
        id: "stock:low",
        category: "stock",
        severity: "warning",
        title: "Stock bajo",
        detail: "3 productos por debajo del mínimo.",
        href: "/inventory?filter=lowStock",
        revision: "rev-stock-2",
      },
    ];

    render(<AlertCenter />);

    expect(
      screen.getByRole("button", { name: "Alertas, 1 sin leer" }),
    ).toBeInTheDocument();
  });

  it("does not ring again for an unchanged alert", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));
    cleanup();

    render(<AlertCenter />);

    expect(screen.getByRole("button", { name: "Alertas" })).toBeInTheDocument();
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
    expect(ledger()).toEqual({
      "billing:past-due": "rev-billing",
      "tasks:overdue": "rev-tasks",
    });
  });

  it("shows the quiet empty state when nothing is pending", () => {
    alertsState.current = [];
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas" }));

    expect(screen.getByText("Todo en orden")).toBeInTheDocument();
  });
});
