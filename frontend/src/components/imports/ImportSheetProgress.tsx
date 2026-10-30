"use client";

import { Badge } from "@/components/ui/Badge";
import { sheetLabel } from "./labels";
import type {
  ImportSheetStatus,
  ImportSheetSubStatus,
} from "@/types";

const statusVariant: Record<
  ImportSheetSubStatus,
  "secondary" | "warning" | "success" | "danger"
> = {
  PENDING: "secondary",
  PROCESSING: "warning",
  COMPLETED: "success",
  REJECTED: "danger",
  FAILED: "danger",
};

interface ImportSheetProgressProps {
  sheets: ImportSheetStatus[];
  isLoading?: boolean;
}

export function ImportSheetProgress({
  sheets,
  isLoading = false,
}: ImportSheetProgressProps) {
  if (isLoading && sheets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Cargando estado de la importacion...
      </p>
    );
  }

  if (sheets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Ninguna hoja reconocida en el archivo.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sheets.map((sheet) => {
        const percent =
          sheet.totalRows > 0
            ? Math.round((sheet.processedRows / sheet.totalRows) * 100)
            : 0;

        return (
          <div
            key={sheet.sheetId}
            className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs sm:text-sm font-semibold text-foreground">
                {sheetLabel(sheet.sheetId)}
              </span>
              <Badge variant={statusVariant[sheet.status]} dot>
                {sheet.status}
              </Badge>
            </div>

            <div>
              <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums mb-1">
                <span>
                  {sheet.processedRows} / {sheet.totalRows} filas
                </span>
                <span className="font-semibold text-foreground">{percent}%</span>
              </div>
              <div className="w-full h-2 rounded-[3px] bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-[3px] bg-foreground/80 transition-all duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums">
              <Badge variant="secondary" className="justify-center">
                Importados: {sheet.imported}
              </Badge>
              <Badge variant="warning" className="justify-center">
                Omitidos: {sheet.skipped}
              </Badge>
              <Badge variant="danger" className="justify-center">
                Errores: {sheet.errors}
              </Badge>
              <Badge variant="primary" className="justify-center">
                Avisos: {sheet.warnings}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
