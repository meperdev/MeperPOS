"use client";

import { useState } from "react";
import { Pencil, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { fieldLabel, sheetLabel } from "./labels";
import type { ImportSheetId, ImportSheetRowError } from "@/types";

type EditableValues = Record<string, string>;

function mapErrorVariant(errorCode: string) {
  if (errorCode.startsWith("DUPLICATE")) {
    return "danger" as const;
  }

  if (errorCode.startsWith("INVALID")) {
    return "warning" as const;
  }

  return "secondary" as const;
}

function groupBySheet(errors: ImportSheetRowError[]): ImportSheetId[] {
  const order: ImportSheetId[] = [];
  const seen = new Set<ImportSheetId>();
  errors.forEach((error) => {
    if (!seen.has(error.sheetId)) {
      seen.add(error.sheetId);
      order.push(error.sheetId);
    }
  });
  return order;
}

interface ImportSheetErrorsProps {
  errors: ImportSheetRowError[];
  retryPending?: boolean;
  onRetry: (
    error: ImportSheetRowError,
    correctedData: Record<string, unknown>,
  ) => void;
}

export function ImportSheetErrors({
  errors,
  retryPending = false,
  onRetry,
}: ImportSheetErrorsProps) {
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<EditableValues>({});

  if (errors.length === 0) {
    return null;
  }

  const sheetOrder = groupBySheet(errors);

  const startEditing = (error: ImportSheetRowError) => {
    setEditingRow(error.row ?? error.rowIndex ?? null);
    const values: EditableValues = {};
    if (error.field) values[error.field] = "";
    setEditValues(values);
  };

  const handleRetry = (error: ImportSheetRowError) => {
    if (!error.field) return;
    const correctedData: Record<string, unknown> = {
      [error.field]: editValues[error.field] ?? "",
    };
    onRetry(error, correctedData);
  };

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-rose-500/20 bg-rose-500/10">
        <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
          Errores por hoja
        </p>
      </div>

      <div className="divide-y divide-rose-500/10">
        {sheetOrder.map((sheetId) => (
          <div key={sheetId} className="p-3.5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {sheetLabel(sheetId)}
            </p>
            {errors
              .filter((error) => error.sheetId === sheetId)
              .map((error) => (
                <div
                  key={`${error.sheetId}-${error.row ?? error.rowIndex}-${error.code ?? error.errorCode}`}
                  data-testid={`import-error-row-${error.row ?? error.rowIndex}`}
                  className="rounded-lg border border-rose-500/20 bg-card/80 p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={mapErrorVariant(error.code ?? error.errorCode ?? "UNKNOWN_ERROR")}>
                        {error.code ?? error.errorCode}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        Fila {error.row ?? error.rowIndex}
                      </span>
                    </div>
                    {error.field && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startEditing(error)}
                      >
                        <Pencil className="w-3.5 h-3.5" /> Editar
                      </Button>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm text-foreground">{error.message}</p>

                  {editingRow === (error.row ?? error.rowIndex) && error.field && (
                    <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          label={fieldLabel(error.field)}
                          value={editValues[error.field] ?? ""}
                          onChange={(event) =>
                            setEditValues((previous) => ({
                              ...previous,
                              [error.field as string]: event.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          loading={retryPending}
                          disabled={retryPending}
                          onClick={() => handleRetry(error)}
                        >
                          <RefreshCcw className="w-3.5 h-3.5" /> Reintentar fila
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingRow(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
