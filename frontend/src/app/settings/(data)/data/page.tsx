"use client";

import { useState } from "react";
import { ImportUpload } from "@/components/imports/ImportUpload";
import { TemplateDownloadButton } from "@/components/imports/TemplateDownloadButton";
import { ImportSheetProgress } from "@/components/imports/ImportSheetProgress";
import { ImportSheetErrors } from "@/components/imports/ImportSheetErrors";
import { useImport } from "@/hooks/useImport";
import { useToast } from "@/contexts/ToastContext";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Input } from "@/components/ui/Input";
import { SettingsCard } from "../../_components/SettingsCard";
import {
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  RefreshCcw,
} from "lucide-react";
import type { ImportSheetRowError } from "@/types";

interface ExportTileDefinition {
  type: string;
  title: string;
  description: string;
  hasDates: boolean;
}

const EXPORT_TILES: ExportTileDefinition[] = [
  {
    type: "products",
    title: "Productos",
    description: "Exporta el catálogo de productos y su stock.",
    hasDates: false,
  },
  {
    type: "sales",
    title: "Ventas",
    description: "Exporta las ventas del período seleccionado.",
    hasDates: true,
  },
  {
    type: "customers",
    title: "Clientes",
    description: "Exporta la cartera de clientes registrados.",
    hasDates: false,
  },
  {
    type: "inventory",
    title: "Movimientos",
    description: "Exporta los movimientos de inventario del período.",
    hasDates: true,
  },
  {
    type: "expenses",
    title: "Gastos",
    description: "Exporta los gastos registrados en el negocio.",
    hasDates: false,
  },
  {
    type: "economic",
    title: "Económico",
    description: "Exporta el reporte económico consolidado del período.",
    hasDates: true,
  },
];

const EXPORT_FORMATS: Array<{ value: "excel" | "csv"; label: string }> = [
  { value: "excel", label: "Excel" },
  { value: "csv", label: "CSV" },
];

function ExportTile({ type, title, description, hasDates }: ExportTileDefinition) {
  const toast = useToast();
  const [format, setFormat] = useState<"excel" | "csv">("excel");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.exportData(`/exports/${type}`, {
        format,
        type,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });
      toast.success("Exportación generada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo generar la exportación"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      data-testid={`export-tile-${type}`}
      className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 transition-colors hover:border-border"
    >
      <div>
        <h3 className="text-xs sm:text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>

      <BentoSelect
        value={format}
        onChange={(value) => setFormat(value as "excel" | "csv")}
        placeholder="Formato de exportación"
        options={EXPORT_FORMATS}
      />

      {hasDates && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            label="Desde"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            type="date"
            label="Hasta"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={handleExport}
        loading={exporting}
        className="w-full shrink-0"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" /> Exportar
      </Button>
    </div>
  );
}

export default function ImportDataSettingsPage() {
  const toast = useToast();
  const {
    startImport,
    statusQuery,
    startData,
    retryRow,
    downloadTemplate,
    reset,
  } = useImport({ mode: "full" });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showExportSection, setShowExportSection] = useState(false);

  const status = statusQuery.data;
  const hasStarted = !!startData;
  const isProcessing = status?.status === "PARSING" || status?.status === "PROCESSING";
  const isFinished = status?.status === "COMPLETED" || status?.status === "FAILED";

  const onFileSelected = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Formato no soportado. Usa un archivo .xlsx");
      return;
    }

    setSelectedFile(file);
  };

  const handleStartImport = async () => {
    if (!selectedFile) {
      toast.error("Selecciona un archivo para iniciar la importacion");
      return;
    }

    try {
      await startImport.mutateAsync(selectedFile);
      toast.success("Importacion iniciada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo iniciar la importacion"));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadTemplate.mutateAsync();
      toast.success("Plantilla descargada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo descargar la plantilla"));
    }
  };

  const handleRetryRow = async (
    error: ImportSheetRowError,
    correctedData: Record<string, unknown>,
  ) => {
    try {
      await retryRow.mutateAsync({
         rowIndex: error.row ?? error.rowIndex ?? 0,
        sheetId: error.sheetId,
        correctedData,
      });
      toast.success("Fila reintentada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo reintentar la fila"));
    }
  };

  const handleReset = () => {
    reset();
    setSelectedFile(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          Importar y exportar datos
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Carga masiva en Excel y descarga de respaldos operativos
        </p>
      </div>

      <SettingsCard
        title="Importación Multi-Hoja"
        description="Importa productos, clientes, proveedores y usuarios desde un archivo (.xlsx)"
        icon={<Database className="w-4 h-4" />}
      >
        <div className="space-y-4">
          {!hasStarted && (
            <>
              <ImportUpload
                selectedFile={selectedFile}
                onFileSelected={onFileSelected}
                onClear={() => setSelectedFile(null)}
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleStartImport}
                  disabled={!selectedFile}
                  loading={startImport.isPending}
                >
                  Iniciar importacion
                </Button>
                <TemplateDownloadButton
                  onDownload={handleDownloadTemplate}
                  loading={downloadTemplate.isPending}
                />
              </div>
            </>
          )}

          {hasStarted && (
            <>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      Archivo
                    </p>
                    <p className="text-xs sm:text-sm font-semibold text-foreground truncate mt-0.5">
                      {selectedFile?.name ?? "Importacion en curso"}
                    </p>
                  </div>

                  <Badge
                    variant={
                      isProcessing ? "warning" : isFinished ? "success" : "primary"
                    }
                    dot
                  >
                    {status?.status ?? "PARSING"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums">
                  <Badge variant="secondary" className="justify-center">
                    Procesados: {status?.processedRows ?? 0}
                  </Badge>
                  <Badge variant="success" className="justify-center">
                    Importados: {status?.importedCount ?? 0}
                  </Badge>
                  <Badge variant="warning" className="justify-center">
                    Omitidos: {status?.skippedCount ?? 0}
                  </Badge>
                  <Badge variant="danger" className="justify-center">
                    Errores: {status?.errorCount ?? 0}
                  </Badge>
                </div>
              </div>

              <ImportSheetProgress
                sheets={status?.sheets ?? []}
                isLoading={statusQuery.isLoading && hasStarted}
              />

              <ImportSheetErrors
                errors={status?.errors ?? []}
                retryPending={retryRow.isPending}
                onRetry={handleRetryRow}
              />

              {isFinished && (
                <div className="flex items-center justify-end gap-2">
                  <div className="flex-1" />
                  {status?.status === "COMPLETED" && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Importacion finalizada
                    </div>
                  )}
                  <TemplateDownloadButton
                    onDownload={handleDownloadTemplate}
                    loading={downloadTemplate.isPending}
                  />
                  <Button variant="primary" onClick={handleReset}>
                    <RefreshCcw className="w-4 h-4" /> Nueva importacion
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <FileSpreadsheet className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
            <span>
              El archivo debe contener las hojas Productos, Clientes, Proveedores y
              Usuarios. Descarga la plantilla para conocer las columnas requeridas.
            </span>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Exportar datos"
        description="Descarga los datos del negocio en formato Excel o CSV"
        icon={<Download className="w-4 h-4" />}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs sm:text-sm text-muted-foreground">
              Exporta productos, ventas, clientes, movimientos, gastos y el reporte
              económico consolidado.
            </p>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setShowExportSection((current) => !current)}
              className="w-full sm:w-auto shrink-0"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {showExportSection ? "Ocultar exportación" : "Exportar datos"}
            </Button>
          </div>

          {showExportSection && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {EXPORT_TILES.map((tile) => (
                <ExportTile key={tile.type} {...tile} />
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
