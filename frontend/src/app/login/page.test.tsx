import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

const loginMock = vi.fn();
const toggleThemeMock = vi.fn();
let currentTheme = "light";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    login: loginMock,
    loading: false,
    user: null,
    isAuthenticated: false,
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: currentTheme,
    toggleTheme: toggleThemeMock,
  }),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} />
  ),
}));

describe("LoginPage Redesign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTheme = "light";
  });

  it("renders the centred access form with the MeperSoft lockup", () => {
    render(<LoginPage />);

    expect(screen.getByText("Acceso al Sistema")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Iniciar sesión" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("login-form-emblem")).toBeInTheDocument();
    expect(
      screen.getByAltText(/MeperPOS emblema oficial Lucky/i)
    ).toHaveAttribute("src", "/brand/login-icon.png");
    expect(screen.getAllByAltText("MeperSoft logo").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("link", { name: /folio\.mepersoft\.app/i }).length
    ).toBeGreaterThanOrEqual(1);

    // The marketing column is gone: no showcase and no operational footer.
    expect(screen.queryByTestId("pos-isometric-showcase")).toBeNull();
    expect(
      screen.queryByText(/Control contable, existencias y caja/i)
    ).toBeNull();
    expect(screen.queryByText(/Bucaramanga • es-CO/i)).toBeNull();
    expect(screen.queryByText(/Tareas en Equipo/i)).toBeNull();
  });

  it("toggles password visibility with the eye icon", async () => {
    render(<LoginPage />);

    const passwordInput = screen.getByLabelText(/contraseña/i, {
      selector: "input",
    });
    expect(passwordInput).toHaveAttribute("type", "password");

    const toggleBtn = screen.getByLabelText("Ver contraseña");
    await userEvent.click(toggleBtn);

    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Ocultar contraseña")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Ocultar contraseña"));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("submits the login form with entered credentials", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    render(<LoginPage />);

    await userEvent.type(
      screen.getByLabelText(/Correo Electrónico/i),
      "admin@meperpos.com"
    );
    await userEvent.type(
      screen.getByLabelText(/contraseña/i, { selector: "input" }),
      "admin123"
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Ingresar al Sistema/i })
    );

    expect(loginMock).toHaveBeenCalledWith(
      "admin@meperpos.com",
      "admin123"
    );
  });

  it("displays an alert error when login fails", async () => {
    loginMock.mockRejectedValueOnce(new Error("Unauthorized"));
    render(<LoginPage />);

    await userEvent.type(
      screen.getByLabelText(/Correo Electrónico/i),
      "wrong@meperpos.com"
    );
    await userEvent.type(
      screen.getByLabelText(/contraseña/i, { selector: "input" }),
      "wrongpass"
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Ingresar al Sistema/i })
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Credenciales incorrectas. Verifica tu correo y contraseña/i)
    ).toBeInTheDocument();
  });

  it("opens and closes the access support modal", async () => {
    render(<LoginPage />);

    expect(
      screen.queryByText("Acceso restringido por organización")
    ).not.toBeInTheDocument();

    const helpBtn = screen.getByRole("button", { name: /Ayuda y soporte/i });
    await userEvent.click(helpBtn);

    expect(
      await screen.findByRole("heading", { name: "Ayuda y Soporte de Acceso" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Acceso restringido por organización")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/soporte@meperpos.com/i)
    ).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: "Entendido" });
    await userEvent.click(closeBtn);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Ayuda y Soporte de Acceso" })
      ).not.toBeInTheDocument();
    });
  });

  it("triggers theme toggle on theme switch button click", async () => {
    render(<LoginPage />);

    const themeBtn = screen.getByRole("button", {
      name: "Cambiar a modo oscuro",
    });
    await userEvent.click(themeBtn);

    expect(toggleThemeMock).toHaveBeenCalledTimes(1);
  });

  it("prevents submission and displays message when email is empty", async () => {
    render(<LoginPage />);

    await userEvent.type(
      screen.getByLabelText(/contraseña/i, { selector: "input" }),
      "ClubDeMotos2026"
    );

    const submitBtn = screen.getByRole("button", {
      name: /Ingresar al Sistema/i,
    });
    const form = submitBtn.closest("form")!;
    fireEvent.submit(form);

    expect(loginMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("Por favor ingresa tu correo electrónico.")
    ).toBeInTheDocument();
  });

  it("reconciles autofilled credentials directly from DOM inputs", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    render(<LoginPage />);

    const emailInput = screen.getByLabelText(/Correo Electrónico/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/contraseña/i, { selector: "input" }) as HTMLInputElement;

    // Simulate password manager directly populating DOM values
    emailInput.value = "autofill@clubdemotos.com";
    passwordInput.value = "ClubDeMotos2026";

    await userEvent.click(
      screen.getByRole("button", { name: /Ingresar al Sistema/i })
    );

    expect(loginMock).toHaveBeenCalledWith(
      "autofill@clubdemotos.com",
      "ClubDeMotos2026"
    );
  });
});
