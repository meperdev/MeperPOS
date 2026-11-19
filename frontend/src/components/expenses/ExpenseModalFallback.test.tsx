import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpenseModalFallback } from "./ExpenseModalFallback";

// S11: opening a Salida for the first time in a session used to insert the
// shared in-flow loading block under the pager before the dialog appeared. The
// modal loading shell is a full-viewport fixed overlay, so it can never take
// space in the page flow.
describe("ExpenseModalFallback", () => {
  it("fills the viewport without entering the page flow", () => {
    render(<ExpenseModalFallback />);

    const shell = screen.getByTestId("expense-modal-fallback");
    expect(shell).toHaveClass("fixed", "inset-0");
  });

  it("only announces the wait once it lasts long enough to be worth a message", () => {
    render(<ExpenseModalFallback />);

    const status = screen.getByRole("status");
    expect(status).toHaveClass("animate-fade-in");
    // Inline, because the fade-in shorthand would reset a utility delay to 0.
    expect(status).toHaveStyle({ animationDelay: "400ms" });
  });
});
