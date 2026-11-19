import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordInput } from "./PasswordInput";

// A controlled host, the way every page in the app uses the field.
function Host({
  showStrength = false,
  onSubmit,
  initial = "",
}: {
  showStrength?: boolean;
  onSubmit?: () => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <PasswordInput
        label="Contraseña"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        showStrength={showStrength}
      />
      <button type="submit">Enviar</button>
    </form>
  );
}

const passwordField = () =>
  screen.getByLabelText("Contraseña", { selector: "input" }) as HTMLInputElement;

describe("PasswordInput", () => {
  it("masks the value by default and reveals it through the toggle", async () => {
    const user = userEvent.setup();
    render(<Host />);

    expect(passwordField()).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(passwordField()).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Ocultar contraseña" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));

    expect(passwordField()).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("button", { name: "Mostrar contraseña" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps focus and the caret inside the field after toggling", async () => {
    const user = userEvent.setup();
    render(<Host />);

    const field = passwordField();
    await user.type(field, "ClubDeMotos2026");
    field.setSelectionRange(4, 4);

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));

    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(4);
    expect(field.selectionEnd).toBe(4);
  });

  it("is a type=button control that never submits the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);

    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle).toHaveAttribute("type", "button");

    await user.click(toggle);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows no strength meter unless asked", () => {
    render(<Host />);

    expect(screen.queryByText("Débil")).not.toBeInTheDocument();
    expect(screen.queryByText("Fuerte")).not.toBeInTheDocument();
  });

  it("rates weak, acceptable, good and strong passwords", async () => {
    const user = userEvent.setup();
    render(<Host showStrength />);

    const field = passwordField();

    await user.type(field, "abc");
    expect(screen.getByText("Débil")).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "password123");
    expect(screen.getByText("Aceptable")).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "Password123");
    expect(screen.getByText("Buena")).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "Password123!");
    expect(screen.getByText("Fuerte")).toBeInTheDocument();
  });

  it("treats length on its own as a real strength signal", async () => {
    const user = userEvent.setup();
    render(<Host showStrength />);

    await user.type(passwordField(), "correct horse battery staple");

    expect(screen.getByText("Buena")).toBeInTheDocument();
  });

  it("announces the strength through a polite live region", async () => {
    const user = userEvent.setup();
    render(<Host showStrength />);

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();

    await user.type(passwordField(), "abc");

    expect(live).toHaveTextContent("Débil");
  });

  it("keeps the meter advisory: a weak password still submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Host showStrength onSubmit={onSubmit} />);

    const field = passwordField();
    await user.type(field, "abc");

    expect(field.checkValidity()).toBe(true);
    expect(field.validity.customError).toBe(false);

    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("passes the autocomplete hint through to the field", () => {
    render(
      <PasswordInput
        label="Contraseña"
        value=""
        onChange={() => {}}
        autoComplete="new-password"
      />,
    );

    expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
  });

  it("still renders the field label and its error", () => {
    render(
      <PasswordInput
        label="Nueva contraseña"
        value="abc"
        onChange={() => {}}
        error="La contraseña debe tener al menos 10 caracteres"
      />,
    );

    expect(
      screen.getByLabelText("Nueva contraseña", { selector: "input" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("La contraseña debe tener al menos 10 caracteres"),
    ).toBeInTheDocument();
  });

  it("does not steal the caret when the user types after revealing", async () => {
    const user = userEvent.setup();
    render(<Host />);

    const field = passwordField();
    await user.type(field, "abcd");
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));

    fireEvent.change(field, { target: { value: "abcdef" } });

    expect(field).toHaveValue("abcdef");
  });
});
