import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountMenu } from "./AccountMenu";

const useAuthMock = vi.fn();
const logoutMock = vi.fn();
const toggleThemeMock = vi.fn();
const pushMock = vi.fn();

const installState = vi.hoisted(() => ({
  current: {
    isAvailable: false,
    canPromptInstall: false,
    needsManualInstall: false,
    isInstalled: true,
    promptInstall: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/dashboard",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: toggleThemeMock }),
}));

vi.mock("@/contexts/InstallPromptContext", () => ({
  useInstallPrompt: () => installState.current,
}));

function setUser(role = "ADMIN") {
  useAuthMock.mockReturnValue({
    user: { id: "user-1", name: "Ana Pérez", role },
    organization: { id: "org-1" },
    logout: logoutMock,
  });
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Opciones de cuenta" }));
  return screen.getByRole("menu", { name: "Opciones de cuenta" });
}

beforeEach(() => {
  vi.clearAllMocks();
  setUser();
  installState.current = {
    isAvailable: false,
    canPromptInstall: false,
    needsManualInstall: false,
    isInstalled: true,
    promptInstall: vi.fn(),
  };
});

afterEach(cleanup);

describe("AccountMenu", () => {
  it("wears the initials and announces a menu", () => {
    render(<AccountMenu />);

    const trigger = screen.getByRole("button", { name: "Opciones de cuenta" });
    expect(trigger).toHaveTextContent("AP");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("names the person and the role inside the menu", () => {
    render(<AccountMenu />);
    openMenu();

    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });

  it("offers the destinations the current role may open", () => {
    render(<AccountMenu />);
    const menu = openMenu();

    const labels = Array.from(
      menu.querySelectorAll('[role="menuitem"]'),
    ).map((item) => item.textContent);

    expect(labels).toEqual([
      "Mi perfil",
      "Configuración",
      "Cambiar a modo oscuro",
      "Cerrar sesión",
    ]);
  });

  it("hides Configuración from a cashier, exactly like the rail does", () => {
    setUser("CASHIER");
    render(<AccountMenu />);
    const menu = openMenu();

    expect(
      Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
        (item) => item.textContent,
      ),
    ).toEqual(["Mi perfil", "Cambiar a modo oscuro", "Cerrar sesión"]);
  });

  it("navigates to the profile", () => {
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Mi perfil" }));

    expect(pushMock).toHaveBeenCalledWith("/profile");
  });

  it("ends the session from Cerrar sesión", () => {
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Cerrar sesión" }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("toggles the theme from the menu", () => {
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Cambiar a modo oscuro" }));

    expect(toggleThemeMock).toHaveBeenCalledTimes(1);
  });

  it("offers the install only when the browser can install", () => {
    render(<AccountMenu />);
    openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Instalar aplicación" }),
    ).not.toBeInTheDocument();

    const promptInstall = vi.fn();
    installState.current = {
      isAvailable: true,
      canPromptInstall: true,
      needsManualInstall: false,
      isInstalled: false,
      promptInstall,
    };
    cleanup();
    render(<AccountMenu />);
    openMenu();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Instalar aplicación" }),
    );

    expect(promptInstall).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and gives the focus back to the avatar", async () => {
    render(<AccountMenu />);
    openMenu();

    await userEvent.keyboard("{Escape}");

    expect(
      screen.queryByRole("menu", { name: "Opciones de cuenta" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Opciones de cuenta" }),
    ).toHaveFocus();
  });

  it("walks the items with the arrow keys", async () => {
    render(<AccountMenu />);
    const menu = openMenu();
    const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');

    await waitFor(() => expect(items[0]).toHaveFocus());

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("closes when the operator clicks outside", () => {
    render(<AccountMenu />);
    openMenu();

    fireEvent.mouseDown(document.body);

    expect(
      screen.queryByRole("menu", { name: "Opciones de cuenta" }),
    ).not.toBeInTheDocument();
  });
});
