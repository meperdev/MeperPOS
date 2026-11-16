import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchField } from "./SearchField";

function stubMediaQuery(answers: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: answers[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

describe("SearchField autofocus follows the pointer", () => {
  it("focuses the field on a fine pointer", () => {
    stubMediaQuery({});

    render(<SearchField value="" onChange={vi.fn()} autoFocus ariaLabel="Buscar productos" />);

    expect(screen.getByRole("searchbox", { name: "Buscar productos" })).toHaveFocus();
  });

  it("leaves the field alone on a touch device, so no keyboard opens by itself", () => {
    stubMediaQuery({ "(pointer: coarse)": true });

    render(<SearchField value="" onChange={vi.fn()} autoFocus ariaLabel="Buscar productos" />);

    expect(screen.getByRole("searchbox", { name: "Buscar productos" })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});

describe("SearchField clearing", () => {
  it("still returns focus to the field after the reader clears it with the button", async () => {
    // An explicit tap may focus a field on any pointer: the keyboard is the
    // answer to what the user just did.
    stubMediaQuery({ "(pointer: coarse)": true });
    const onChange = vi.fn();

    render(<SearchField value="cafe" onChange={onChange} ariaLabel="Buscar productos" />);
    const field = screen.getByRole("searchbox", { name: "Buscar productos" });

    await userEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));

    expect(onChange).toHaveBeenCalledWith("");
    expect(field).toHaveFocus();
  });
});
