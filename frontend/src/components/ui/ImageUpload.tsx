"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "./Button";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onUpload?: (file: File) => Promise<string>;
  /** Controlled draft mode: selecting only changes the file, never uploads. */
  file?: File | null;
  onFileChange?: (file: File | null) => void;
  disabled?: boolean;
  /** `hero` renders a large 4:3 (4:5 on md+) photo with overlay icon buttons. */
  variant?: "default" | "hero";
}

export function ImageUpload({
  value,
  onChange,
  onUpload,
  file,
  onFileChange,
  disabled = false,
  variant = "default",
}: ImageUploadProps) {
  const toast = useToast();
  const [preview, setPreview] = useState<string | null>(value || null);
  const [draftPreview, setDraftPreview] = useState<{ file: File; url: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!onFileChange || !file) return;
    const url = URL.createObjectURL(file);
    setDraftPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, onFileChange]);

  const visiblePreview = onFileChange
    ? file ? (draftPreview?.file === file ? draftPreview.url : null) : value || null
    : preview;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clearing the input allows selecting the same file again after removal.
    e.target.value = "";
    if (file.size > 5 * 1024 * 1024) {
      toast.error("El archivo es demasiado grande. Tamaño maximo: 5MB.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona un archivo de imagen valido.");
      return;
    }

    if (onFileChange) {
      onFileChange(file);
      return;
    }

    setIsUploading(true);

    try {
      if (onUpload) {
        const imageUrl = await onUpload(file);
        setPreview(imageUrl);
        onChange(imageUrl);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          setPreview(result);
          onChange(result);
        };
        reader.readAsDataURL(file);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al subir la imagen"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onFileChange?.(null);
    onChange("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  if (variant === "hero") {
    const overlayButtonClass = cn(
      "group/overlay flex h-11 w-11 items-center justify-center rounded-full",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      "disabled:cursor-not-allowed disabled:opacity-50",
    );
    const overlayDiscClass =
      "flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white transition-colors group-hover/overlay:bg-black/70";

    return (
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />

        {visiblePreview ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-muted md:aspect-square">
            <Image
              src={visiblePreview}
              alt="Preview"
              fill
              sizes="(max-width: 768px) 100vw, 320px"
              unoptimized={visiblePreview.startsWith("data:") || visiblePreview.startsWith("blob:")}
              className="object-cover"
            />
            <div className="absolute bottom-2 right-2 z-10 flex gap-1.5">
              <button
                type="button"
                onClick={handleClick}
                disabled={disabled}
                aria-label="Cambiar"
                title="Cambiar"
                className={overlayButtonClass}
              >
                <span className={overlayDiscClass}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={disabled}
                aria-label="Eliminar"
                title="Eliminar"
                className={overlayButtonClass}
              >
                <span className={overlayDiscClass}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled}
            className={cn(
              "aspect-[4/3] w-full rounded-2xl border border-dashed border-border/80 bg-muted/30 md:aspect-square",
              "flex cursor-pointer flex-col items-center justify-center px-3 text-center",
              "transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {isUploading ? (
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
            ) : (
              <>
                <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground shadow-2xs">
                  <ImageIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <span className="text-xs font-medium text-foreground">Seleccionar imagen</span>
                <span className="mt-1 text-[11px] leading-relaxed text-muted-foreground">JPG, PNG, GIF o WEBP · Máx. 5 MB</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />

      {visiblePreview ? (
        <>
          <div className="relative aspect-square w-full rounded-xl overflow-hidden border border-border bg-muted">
            <Image
              src={visiblePreview}
              alt="Preview"
              fill
              sizes="(max-width: 768px) 240px, 320px"
              unoptimized={visiblePreview.startsWith("data:") || visiblePreview.startsWith("blob:")}
              className="object-cover"
            />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={handleClick} disabled={disabled} className="min-h-10">
              <Upload className="w-4 h-4" /> Cambiar
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={handleRemove} disabled={disabled} className="min-h-10">
              <X className="w-4 h-4" /> Eliminar
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          className={cn(
            "aspect-square w-full rounded-xl border border-dashed border-border/80 bg-muted/30",
            "flex flex-col items-center justify-center cursor-pointer text-center px-3",
            "hover:border-border hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary transition-colors",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {isUploading ? (
            <span className="animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground/30 border-t-primary" />
          ) : (
            <>
              <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground shadow-2xs">
                <ImageIcon className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium text-foreground">Seleccionar imagen</span>
              <span className="text-[11px] text-muted-foreground mt-1 leading-relaxed">JPG, PNG, GIF o WEBP · Máx. 5 MB</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
