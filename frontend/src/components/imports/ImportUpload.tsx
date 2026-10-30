"use client";

import { ChangeEvent, DragEvent, useState } from "react";
import { AlertCircle, FileSpreadsheet, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportUploadProps {
  selectedFile: File | null;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  error?: string | null;
}

export function ImportUpload({
  selectedFile,
  onFileSelected,
  onClear,
  error,
}: ImportUploadProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleInputFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file) {
      onFileSelected(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <div className="space-y-3">
      <label
        data-testid="import-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "block rounded-xl border border-dashed px-4 py-7 text-center cursor-pointer transition-colors",
          dragActive
            ? "border-border bg-muted/40"
            : "border-border/70 bg-muted/20 hover:border-border hover:bg-muted/30",
        )}
      >
        <input
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleInputFile}
        />
        <FileSpreadsheet className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs sm:text-sm font-semibold text-foreground">
          Arrastra un archivo o haz click para subir
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Multi-hoja: Productos, Clientes, Proveedores, Usuarios (.xlsx)
        </p>
      </label>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {selectedFile && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-medium text-foreground truncate">
              {selectedFile.name}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/60 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Limpiar
          </button>
        </div>
      )}
    </div>
  );
}
