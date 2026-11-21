import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

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

  it("dresses each row with a severity tile and a trailing chevron", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    const critical = screen.getByText("Suscripción vencida").closest("a")!;
    const warning = screen.getByText("2 tareas vencidas").closest("a")!;

    const criticalTile = critical.querySelector("span.grid")!;
    expect(criticalTile.className).toContain("h-8");
    expect(criticalTile.className).toContain("w-8");
    expect(criticalTile.className).toContain("bg-danger/10");
    expect(criticalTile.className).toContain("text-danger-text");

    const warningTile = warning.querySelector("span.grid")!;
    expect(warningTile.className).toContain("bg-warning/10");
    expect(warningTile.className).toContain("text-warning-text");

    // The chevron only appears under the pointer or the keyboard, so the row
    // reads as quiet until it is the row being read.
    const chevron = critical.querySelector("svg.lucide-chevron-right")!;
    expect(chevron.getAttribute("class")).toContain("opacity-0");
    expect(chevron.getAttribute("class")).toContain(
      "group-hover:opacity-100",
    );

    // The unread dot keeps its place, ahead of the chevron.
    const dot = critical.querySelector('[data-testid="alert-unread-dot"]')!;
    expect(
      dot.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("links to the notification history from the panel header", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    const history = screen.getByRole("link", {
      name: "Ver historial de notificaciones",
    });
    expect(history).toHaveAttribute("href", "/alerts");
    // The header carries the door now, worded for the space it has; the footer
    // block that used to hold it is gone.
    expect(history.textContent).toBe("Ver historial");
    const panel = screen.getByRole("dialog", { name: "Alertas" });
    expect(panel.firstElementChild?.contains(history)).toBe(true);
    expect(panel.lastElementChild?.tagName).toBe("UL");
  });

  it("closes the panel when following the history link", () => {
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    fireEvent.click(
      screen.getByRole("link", { name: "Ver historial de notificaciones" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Alertas" }),
    ).not.toBeInTheDocument();
  });

  it("shows the quiet empty state when nothing is pending", () => {
    alertsState.current = [];
    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas" }));

    expect(screen.getByText("Todo en orden")).toBeInTheDocument();
  });

  it("keeps both acknowledgements made in the same tick", () => {
    // Nothing to acknowledge yet, so opening the panel writes no ledger entry.
    alertsState.current = [];
    const { rerender } = render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas" }));
    expect(ledger()).toEqual({});

    // A refetch brings the alerts in while the panel is already open: two rows
    // can now be followed before React re-renders, which is how the header and
    // the rail (one ledger, two bells) race each other.
    alertsState.current = twoAlerts;
    rerender(<AlertCenter />);

    const first = screen.getByText("Suscripción vencida").closest("a")!;
    const second = screen.getByText("2 tareas vencidas").closest("a")!;
    act(() => {
      first.click();
      second.click();
    });

    expect(ledger()).toEqual({
      "billing:past-due": "rev-billing",
      "tasks:overdue": "rev-tasks",
    });
  });
});

describe("AlertCenter mobile panel", () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
      writable: true,
    });
  });

  it("opens below the mobile header and pays the side insets", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
      writable: true,
    });
    alertsState.current = twoAlerts;
    localStorage.clear();
    render(<AlertCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    const panel = screen.getByRole("dialog", { name: "Alertas" });
    expect(panel.className).toContain("var(--mobile-header)");
    expect(panel.className).toContain("var(--safe-top)");
    expect(panel.className).toContain("var(--safe-left)");
    expect(panel.className).toContain("var(--safe-right)");
    // Never taller than the viewport it is pinned into.
    expect(panel.className).toContain("100dvh");
  });
});

function setViewport(width: number, height: number) {
  for (const [key, value] of [
    ["innerWidth", width],
    ["innerHeight", height],
  ] as const) {
    Object.defineProperty(window, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

function domRect(top: number, bottom: number, left: number, right: number) {
  return {
    top,
    bottom,
    left,
    right,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * The desktop header mounts the bell at the top of the screen, where the rail
 * flyout math would open the panel over the header and hide the bell and the
 * avatar next to it. The mount site names that placement, so the panel hangs
 * under its own trigger and ends on the account menu's right edge.
 */
describe("AlertCenter header placement", () => {
  beforeEach(() => {
    localStorage.clear();
    alertsState.current = twoAlerts;
    setViewport(1590, 913);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setViewport(1024, 768);
  });

  it("opens below the bell, aligned with the header's right content edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-app-header-actions")) {
          return domRect(0, 56, 1500, 1566);
        }
        if (this.getAttribute("aria-label")?.startsWith("Alertas")) {
          return domRect(12, 44, 1468, 1500);
        }
        return domRect(0, 0, 0, 0);
      },
    );

    render(
      <div data-app-header-actions="">
        <AlertCenter placement="header" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    const panel = screen.getByRole("dialog", { name: "Alertas" });
    // 8px under the bell's own bottom edge.
    expect(panel.style.top).toBe("52px");
    // Right edge on the same line as the account menu.
    expect(panel.style.left).toBe("1214px");
    expect(panel.style.bottom).toBe("");
    // Same width as the rail flyout, capped by the space left below.
    expect(panel.className).toContain("w-[22rem]");
    expect(panel.style.maxHeight).toBe("849px");
  });

  it("gives the focus back to the bell on Escape", () => {
    render(<AlertCenter placement="header" />);

    const bell = screen.getByRole("button", { name: "Alertas, 2 sin leer" });
    fireEvent.click(bell);
    expect(screen.getByRole("dialog", { name: "Alertas" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Alertas" }),
    ).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it("keeps the rail flyout for a mount that names no placement", () => {
    setViewport(1440, 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute("aria-label")?.startsWith("Alertas")) {
          return domRect(768, 800, 268, 300);
        }
        return domRect(0, 0, 0, 0);
      },
    );

    render(<AlertCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Alertas, 2 sin leer" }));

    const panel = screen.getByRole("dialog", { name: "Alertas" });
    // Right of the rail and growing upward, exactly as the footer bell does.
    expect(panel.style.left).toBe("312px");
    expect(panel.style.bottom).toBe("100px");
  });
});
