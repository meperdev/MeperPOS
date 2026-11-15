import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImportSheetErrors } from "./ImportSheetErrors";
import type { ImportSheetRowError } from "@/types";

function makeError(overrides: Partial<ImportSheetRowError> = {}): ImportSheetRowError {
  return {
    row: 5,
    sheetId: "clientes",
    code: "DUPLICATE_DOCUMENT",
    message: "Documento duplicado",
    field: "documentNumber",
    editableFields: ["documentNumber"],
    retried: false,
    retriedSuccess: false,
    correlationId: "request-123",
    ...overrides,
  };
}

describe("ImportSheetErrors", () => {
  it("does not render anything when there are no errors", () => {
    render(<ImportSheetErrors errors={[]} onRetry={vi.fn()} />);
    expect(screen.queryByText(/Fila/)).not.toBeInTheDocument();
  });

  it("groups errors by their originating sheet", () => {
    render(
      <ImportSheetErrors
        errors={[
          makeError({ sheetId: "clientes" }),
          makeError({ row: 9, sheetId: "productos", code: "INVALID_PRICE" }),
        ]}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Productos")).toBeInTheDocument();
    expect(screen.getByText("Fila 5")).toBeInTheDocument();
    expect(screen.getByText("Fila 9")).toBeInTheDocument();
  });

  it("shows the Spanish label for the error code and never the raw code", () => {
    render(
      <ImportSheetErrors
        errors={[
          makeError({ code: "DUPLICATE_DOCUMENT" }),
          makeError({ row: 9, sheetId: "productos", code: undefined, errorCode: "INVALID_PRICE", field: undefined, editableFields: [] }),
        ]}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Documento ya registrado")).toBeInTheDocument();
    expect(screen.getByText("Precio inválido")).toBeInTheDocument();
    expect(screen.queryByText("DUPLICATE_DOCUMENT")).not.toBeInTheDocument();
    expect(screen.queryByText("INVALID_PRICE")).not.toBeInTheDocument();
  });

  it("renders the error message and editable fields", () => {
    render(<ImportSheetErrors errors={[makeError()]} onRetry={vi.fn()} />);

    expect(screen.getByText("Documento duplicado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Editar/i }));
    expect(screen.getByLabelText("N° documento")).toBeInTheDocument();
  });

  it("calls onRetry with the error and the edited corrected data", () => {
    const onRetry = vi.fn();
    render(<ImportSheetErrors errors={[makeError()]} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /Editar/i }));
    fireEvent.change(screen.getByLabelText("N° documento"), {
      target: { value: "2020202" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Reintentar fila/i }));

    expect(onRetry).toHaveBeenCalledOnce();
    const [error, correctedData] = onRetry.mock.calls[0] as [
      ImportSheetRowError,
      Record<string, unknown>,
    ];
    expect(error.row).toBe(5);
    expect(error.sheetId).toBe("clientes");
    expect(correctedData).toEqual({ documentNumber: "2020202" });
  });

  it("does not offer retry for a sanitized issue without a field", () => {
    render(
      <ImportSheetErrors
        errors={[makeError({ field: undefined, editableFields: [] })]}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Editar/i })).not.toBeInTheDocument();
  });
});
