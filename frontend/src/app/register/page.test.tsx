import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegisterPage from "./page";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
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

describe("RegisterPage Standby State", () => {
  it("renders the institutional standby message and back to login button", async () => {
    render(<RegisterPage />);

    expect(screen.getByText("Acceso Restringido")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Creación de cuentas por invitación" })
    ).toBeInTheDocument();
    expect(screen.getByText(/soporte@meperpos.com/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /folio\.mepersoft\.app/i })
    ).toBeInTheDocument();

    const backBtn = screen.getByRole("button", {
      name: /Volver al Inicio de Sesión/i,
    });
    await userEvent.click(backBtn);

    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
