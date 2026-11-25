import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from "@/lib/command-palette";
import { AppHeader } from "./AppHeader";

const useAuthMock = vi.fn();
const toggleThemeMock = vi.fn();

const themeState = vi.hoisted(() => ({ current: "light" as "light" | "dark" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: themeState.current, toggleTheme: toggleThemeMock }),
}));

vi.mock("@/contexts/InstallPromptContext", () => ({
  useInstallPrompt: () => ({
    isAvailable: false,
    canPromptInstall: false,
    needsManualInstall: false,
    isInstalled: true,
    promptInstall: vi.fn(),
  }),
}));

// The bell is a surface with its own suite; here only its slot matters.
vi.mock("@/components/layout/AlertCenter", () => ({
  AlertCenter: ({ placement }: { placement?: string }) => (
    <button type="button" aria-label="Alertas" data-placement={placement} />
  ),
}));

function setUser(role = "ADMIN") {
  useAuthMock.mockReturnValue({
    user: { id: "user-1", name: "Ana Pérez", role },
    organization: { id: "org-1" },
    logout: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setUser();
  themeState.current = "light";
  closeCommandPalette();
});

afterEach(() => {
  cleanup();
  closeCommandPalette();
});

describe("AppHeader", () => {
  it("offers the global search, the bell and the account button", () => {
    render(<AppHeader isCollapsed={false} />);

    expect(
      screen.getByRole("button", { name: /Buscar en MeperPOS/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alertas" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Opciones de cuenta" }),
    ).toHaveTextContent("AP");
  });

  it("mounts the bell in the header placement", () => {
    render(<AppHeader isCollapsed={false} />);

    // The mount site owns the placement: the same bell in the rail footer opens
    // as a flyout, in the header it has to hang below its own row.
    expect(screen.getByRole("button", { name: "Alertas" })).toHaveAttribute(
      "data-placement",
      "header",
    );
  });

  it("puts the theme toggle between the search and the bell", () => {
    render(<AppHeader isCollapsed={false} />);

    const actions = document.querySelector("[data-app-header-actions]")!;
    const controls = Array.from(actions.querySelectorAll("button")).map((node) =>
      node.getAttribute("aria-label"),
    );

    // Order is the contract: the mode, then the inbox, then the identity.
    expect(controls).toEqual([
      "Cambiar a modo oscuro",
      "Alertas",
      "Opciones de cuenta",
    ]);
  });

  it("names the mode the click switches to", () => {
    render(<AppHeader isCollapsed={false} />);

    const light = screen.getByRole("button", { name: "Cambiar a modo oscuro" });
    expect(light).toHaveAttribute("title", "Cambiar a modo oscuro");
    expect(light.querySelector("svg.lucide-moon")).not.toBeNull();

    cleanup();
    themeState.current = "dark";
    render(<AppHeader isCollapsed={false} />);

    const dark = screen.getByRole("button", { name: "Cambiar a modo claro" });
    expect(dark.querySelector("svg.lucide-sun")).not.toBeNull();
  });

  it("switches the theme from the header", () => {
    render(<AppHeader isCollapsed={false} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Cambiar a modo oscuro" }),
    );

    expect(toggleThemeMock).toHaveBeenCalledTimes(1);
  });

  it("opens the command palette from the search field", () => {
    render(<AppHeader isCollapsed={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Buscar en MeperPOS/ }));

    expect(isCommandPaletteOpen()).toBe(true);
  });

  it("is the desktop bar, at the shared header height", () => {
    render(<AppHeader isCollapsed={false} />);

    const header = screen.getByTestId("app-header");
    expect(header.className).toContain("hidden");
    expect(header.className).toContain("lg:flex");
    // One token, four surfaces: the bar, the skeleton, the column and POS.
    expect(header.className).toContain("h-[var(--app-header-height)]");
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("border-b");
  });

  it("follows the rail's width so it sits right of the sidebar", () => {
    const { rerender } = render(<AppHeader isCollapsed={false} />);

    expect(screen.getByTestId("app-header").className).toContain(
      "lg:ml-[256px]",
    );

    rerender(<AppHeader isCollapsed />);

    expect(screen.getByTestId("app-header").className).toContain(
      "lg:ml-[72px]",
    );
  });

  it("names the shortcut on the field", () => {
    render(<AppHeader isCollapsed={false} />);

    expect(
      screen.getByRole("button", { name: /Buscar en MeperPOS/ }),
    ).toHaveTextContent("Ctrl K");
  });
});
