import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  ImportFullJobStatus,
  ImportSheetStatus,
  ImportSheetRowError,
} from "@/types";

const { exportDataMock } = vi.hoisted(() => ({ exportDataMock: vi.fn() }));

const useImportMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("@/hooks/useImport", () => ({
  useImport: () => useImportMock(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { exportData: exportDataMock },
  };
});

vi.mock("@/components/ui/Select", () => ({
  Select: ({
    value,
    onChange,
    options,
    placeholder,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
    label?: string;
  }) => (
    <select
      aria-label={label || placeholder || "Formato de exportación"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import ImportDataSettingsPage from "./page";

function makeRow(overrides: Partial<ImportSheetRowError> = {}): ImportSheetRowError {
  return {
    rowIndex: 5,
    sheetId: "clientes",
    errorCode: "INVALID_DOCUMENT",
    message: "Documento invalido",
    mappedData: { name: "Ana Perez", documentNumber: "1010101" },
    editableFields: ["name", "documentNumber"],
    retried: false,
    retriedSuccess: false,
    ...overrides,
  };
}

function makeSheet(overrides: Partial<ImportSheetStatus> = {}): ImportSheetStatus {
  return {
    sheetId: "productos",
    status: "COMPLETED",
    totalRows: 10,
    processedRows: 10,
    imported: 10,
    skipped: 0,
    errors: 0,
    warnings: 0,
    rowErrors: [],
    ...overrides,
  };
}

function makeFullStatus(
  overrides: Partial<ImportFullJobStatus> = {},
): ImportFullJobStatus {
  return {
    jobId: "job-1",
    status: "COMPLETED",
    fileName: "import.xlsx",
    totalRows: 20,
    processedRows: 19,
    importedCount: 18,
    skippedCount: 0,
    errorCount: 1,
    warningCount: 0,
    sheets: [makeSheet(), makeSheet({ sheetId: "clientes", errors: 1, rowErrors: [makeRow()] })],
    errors: [makeRow()],
    ...overrides,
  };
}

function makeImportResult(status: ImportFullJobStatus | undefined) {
  return {
    startImport: { mutateAsync: vi.fn().mockResolvedValue({ jobId: "job-1" }), isPending: false },
    statusQuery: { data: status, isLoading: false },
    startData: status ? { jobId: status.jobId, totalRows: status.totalRows, detectedColumns: [], columnMapping: {} } : null,
    retryRow: { mutateAsync: vi.fn().mockResolvedValue(status), isPending: false },
    downloadTemplate: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    reset: vi.fn(),
  };
}

describe("ImportDataSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the importer with the upload zone and the template button before starting", () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));

    render(<ImportDataSettingsPage />);

    expect(screen.getByText("Importar y exportar datos")).toBeInTheDocument();
    expect(screen.getByText("Importación multi-hoja")).toBeInTheDocument();
    expect(screen.getByText(/Arrastra un archivo o haz clic para subir/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plantilla/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Iniciar importación/i })).toBeInTheDocument();
  });

  it("requires an .xlsx file before starting", async () => {
    const result = makeImportResult(undefined);
    useImportMock.mockReturnValue(result);

    render(<ImportDataSettingsPage />);

    const file = new File(["xlsx"], "datos.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(toastError).toHaveBeenCalledWith("Formato no soportado. Usa un archivo .xlsx");
    expect(screen.getByRole("button", { name: /Iniciar importación/i })).toBeDisabled();
  });

  it("starts a full import when a valid .xlsx file is selected and submitted", async () => {
    const result = makeImportResult(undefined);
    useImportMock.mockReturnValue(result);
    const mutateAsync = result.startImport.mutateAsync;

    render(<ImportDataSettingsPage />);

    const file = new File(["xlsx"], "import.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /Iniciar importación/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith(file);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Importación iniciada correctamente"));
  });

  it("renders the per-sheet progress and errors after an import completes", () => {
    useImportMock.mockReturnValue(makeImportResult(makeFullStatus()));

    render(<ImportDataSettingsPage />);

    expect(screen.getAllByText("Productos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clientes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completada").length).toBeGreaterThan(0);
    expect(screen.getByText(/Errores por hoja/)).toBeInTheDocument();
    expect(screen.getByText("Documento invalido")).toBeInTheDocument();
  });

  it("fires the multi-sheet template download", async () => {
    const result = makeImportResult(undefined);
    useImportMock.mockReturnValue(result);

    render(<ImportDataSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Plantilla/i }));
    await waitFor(() => expect(result.downloadTemplate.mutateAsync).toHaveBeenCalledOnce());
  });

  it("renders every export tile only after expanding the export section", () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));

    render(<ImportDataSettingsPage />);

    // Hidden by default: the tile grid is collapsed.
    expect(screen.queryByText("Productos")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Exportar datos/ }));

    for (const title of [
      "Productos",
      "Ventas",
      "Clientes",
      "Movimientos",
      "Gastos",
      "Económico",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("toggles the export panel closed from the expanded state", () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));

    render(<ImportDataSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: /Exportar datos/ }));
    expect(screen.getByRole("button", { name: /Ocultar exportación/ })).toBeInTheDocument();
    expect(screen.getByText("Productos")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ocultar exportación/ }));
    expect(screen.getByRole("button", { name: /Exportar datos/ })).toBeInTheDocument();
    expect(screen.queryByText("Productos")).not.toBeInTheDocument();
  });

  it("exports the products tile with the right endpoint and default format", async () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));
    exportDataMock.mockResolvedValue(undefined);

    render(<ImportDataSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar datos/ }));

    const productsTile = screen.getByTestId("export-tile-products");
    fireEvent.click(within(productsTile).getByRole("button", { name: /Exportar/ }));

    await waitFor(() => expect(exportDataMock).toHaveBeenCalledOnce());
    expect(exportDataMock).toHaveBeenCalledWith(
      "/exports/products",
      expect.objectContaining({ type: "products", format: "excel" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Exportación generada correctamente");
  });

  it("exports the sales tile with the csv format", async () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));
    exportDataMock.mockResolvedValue(undefined);

    render(<ImportDataSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar datos/ }));

    const salesTile = screen.getByTestId("export-tile-sales");
    fireEvent.change(within(salesTile).getByRole("combobox"), {
      target: { value: "csv" },
    });

    fireEvent.click(within(salesTile).getByRole("button", { name: /Exportar/ }));

    await waitFor(() => expect(exportDataMock).toHaveBeenCalledOnce());
    expect(exportDataMock).toHaveBeenCalledWith(
      "/exports/sales",
      expect.objectContaining({ type: "sales", format: "csv" }),
    );
  });

  it("sends the date range payload for date-bearing tiles", async () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));
    exportDataMock.mockResolvedValue(undefined);

    render(<ImportDataSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar datos/ }));

    const economicTile = screen.getByTestId("export-tile-economic");
    const [startInput, endInput] = within(economicTile).getAllByLabelText(/Desde|Hasta/);
    fireEvent.change(startInput, { target: { value: "2026-01-01" } });
    fireEvent.change(endInput, { target: { value: "2026-01-31" } });

    fireEvent.click(within(economicTile).getByRole("button", { name: /Exportar/ }));

    await waitFor(() => expect(exportDataMock).toHaveBeenCalledOnce());
    expect(exportDataMock).toHaveBeenCalledWith(
      "/exports/economic",
      expect.objectContaining({
        type: "economic",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      }),
    );
  });

  it("surfaces the error toast when a tile export fails", async () => {
    useImportMock.mockReturnValue(makeImportResult(undefined));
    exportDataMock.mockRejectedValue(new Error("El servidor falló"));

    render(<ImportDataSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar datos/ }));

    const productsTile = screen.getByTestId("export-tile-products");
    fireEvent.click(within(productsTile).getByRole("button", { name: /Exportar/ }));

    await waitFor(() => expect(exportDataMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudo generar la exportación"));
  });
});
