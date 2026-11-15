import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportSheetProgress } from "./ImportSheetProgress";
import type { ImportSheetStatus } from "@/types";

function makeSheet(overrides: Partial<ImportSheetStatus> = {}): ImportSheetStatus {
  return {
    sheetId: "productos",
    status: "PROCESSING",
    totalRows: 10,
    processedRows: 5,
    imported: 4,
    skipped: 0,
    errors: 1,
    warnings: 0,
    rowErrors: [],
    ...overrides,
  };
}

describe("ImportSheetProgress", () => {
  it("renders each sheet with its label and sub-status", () => {
    render(
      <ImportSheetProgress
        sheets={[
          makeSheet({ sheetId: "clientes", status: "COMPLETED" }),
          makeSheet({ sheetId: "usuarios", status: "REJECTED" }),
        ]}
      />,
    );

    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Completada")).toBeInTheDocument();
    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
  });

  it("renders per-sheet counters", () => {
    render(
      <ImportSheetProgress
        sheets={[makeSheet({ imported: 7, errors: 2, skipped: 1 })]}
      />,
    );

    expect(screen.getByText(/Importados: 7/)).toBeInTheDocument();
    expect(screen.getByText(/Errores: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Omitidos: 1/)).toBeInTheDocument();
  });

  it("computes a progress percentage from processed/total rows", () => {
    render(
      <ImportSheetProgress
        sheets={[makeSheet({ processedRows: 5, totalRows: 10 })]}
      />,
    );

    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("shows a loading placeholder when there are no sheets yet", () => {
    render(<ImportSheetProgress sheets={[]} isLoading />);
    expect(screen.getByText(/Cargando estado/i)).toBeInTheDocument();
  });
});
