import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from "@/lib/command-palette";
import { MobileTopBar } from "./MobileTopBar";

const pushMock = vi.fn();
const backMock = vi.fn();
let currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: backMock }),
}));

// The bell is another surface with its own suite; here only its slot matters.
vi.mock("@/components/layout/AlertCenter", () => ({
  AlertCenter: () => <button type="button" aria-label="Notificaciones" />,
}));

/** jsdom starts every test with a single history entry: no in-app history. */
function setHistoryLength(length: number) {
  Object.defineProperty(window.history, "length", {
    value: length,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentPathname = "/dashboard";
  setHistoryLength(1);
  closeCommandPalette();
});

afterEach(() => {
  cleanup();
  setHistoryLength(1);
  closeCommandPalette();
});

describe("MobileTopBar section title", () => {
  it.each([
    ["/customers", "Clientes"],
    ["/dashboard", "Panel"],
    ["/pos", "POS"],
    ["/inventory", "Inventario"],
  ])("names %s with the label the rail uses (%s)", (pathname, title) => {
    currentPathname = pathname;
    render(<MobileTopBar />);

    expect(screen.getByTestId("mobile-topbar-title")).toHaveTextContent(title);
  });

  it("names the section, not the record, on a detail route", () => {
    currentPathname = "/sales/abc";
    render(<MobileTopBar />);

    expect(screen.getByTestId("mobile-topbar-title")).toHaveTextContent("Ventas");
  });

  it("names a settings subpage by its section", () => {
    currentPathname = "/settings/team";
    render(<MobileTopBar />);

    expect(screen.getByTestId("mobile-topbar-title")).toHaveTextContent(
      "Configuración",
    );
  });
});

describe("MobileTopBar back affordance", () => {
  it("offers a back control on a nested route", () => {
    currentPathname = "/sales/abc";
    render(<MobileTopBar />);

    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("offers no back control on a section root", () => {
    currentPathname = "/sales";
    render(<MobileTopBar />);

    expect(
      screen.queryByRole("button", { name: "Volver" }),
    ).not.toBeInTheDocument();
  });

  it("returns through history when the app has any", async () => {
    currentPathname = "/sales/abc";
    setHistoryLength(3);
    render(<MobileTopBar />);

    await userEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(backMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("falls back to the parent route when there is no history", async () => {
    currentPathname = "/sales/abc";
    render(<MobileTopBar />);

    await userEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(pushMock).toHaveBeenCalledWith("/sales");
    expect(backMock).not.toHaveBeenCalled();
  });

  it("falls back from a purchase order creation page to its list", async () => {
    currentPathname = "/purchase-orders/new";
    render(<MobileTopBar />);

    await userEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(pushMock).toHaveBeenCalledWith("/purchase-orders");
  });
});

describe("MobileTopBar chrome", () => {
  it("keeps the bell on the right and retires the hamburger", () => {
    currentPathname = "/dashboard";
    render(<MobileTopBar />);

    expect(
      screen.getByRole("button", { name: "Notificaciones" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /menú/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the same search palette the desktop header opens", () => {
    currentPathname = "/dashboard";
    render(<MobileTopBar />);

    expect(isCommandPaletteOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Buscar en MeperPOS" }));

    expect(isCommandPaletteOpen()).toBe(true);
  });

  it("pays the notch on its own height and hides from lg up", () => {
    render(<MobileTopBar />);

    const header = screen.getByRole("banner");
    expect(header.className).toContain("lg:hidden");
    expect(header.className).toContain(
      "h-[calc(var(--mobile-header)+var(--safe-top))]",
    );
    expect(header.className).toContain("pt-[var(--safe-top)]");
  });
});
