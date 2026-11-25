"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { z } from "zod";
import {
  useSettings,
  useUploadLogo,
  useUpdateOrganizationName,
} from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { InstallAppCard } from "../../_components/InstallAppCard";
import { SettingsCard } from "../../_components/SettingsCard";
import { ThemeSelector } from "@/components/ui/ThemeSelector";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Building2, Image as ImageIcon, Palette, Upload } from "lucide-react";

/**
 * Mirrors `ORGANIZATION_NAME_MAX_LENGTH` in
 * `backend/src/settings/dto/settings.dto.ts` (and the admin organization DTOs):
 * the business name prints in the receipt header. The server stays the
 * boundary; this only stops an over-long name before it is sent.
 */
const ORGANIZATION_NAME_MAX_LENGTH = 100;

const organizationNameSchema = z
  .string()
  .trim()
  .min(1, "Ingresa el nombre del negocio.")
  .max(
    ORGANIZATION_NAME_MAX_LENGTH,
    `El nombre no puede superar los ${ORGANIZATION_NAME_MAX_LENGTH} caracteres.`,
  );

/**
 * One settings row: the label and its explanation sit on the left rail, the
 * control on the right. Below `lg` the two stack so phones keep a full-width
 * control instead of a squeezed column.
 */
function SettingsRow({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 px-4 py-5 sm:px-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-x-8",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Pure presentation: the receipt header exactly as the logo and the business
 * name will print on top of a comprobante.
 */
function ReceiptHeaderPreview({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  const shownName = name.trim();

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
      <div className="border-b border-border/60 px-4 py-3.5">
        <h3 className="text-sm font-medium tracking-tight text-foreground">
          Vista previa del comprobante
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Así se ve la cabecera de tus recibos.
        </p>
      </div>

      <div className="bg-muted/20 p-4">
        <article
          aria-label="Cabecera del comprobante"
          className="mx-auto w-full max-w-[19rem] rounded-lg border border-border/70 bg-card px-5 py-4 text-center"
        >
          <div className="flex min-h-12 items-center justify-center">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Logo en el comprobante"
                width={144}
                height={48}
                unoptimized
                className="h-auto max-h-12 w-auto max-w-36 object-contain"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border/70 bg-muted/30 text-muted-foreground"
              >
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </div>
          <p
            className={cn(
              "mt-2 break-words text-sm font-semibold tracking-tight",
              shownName ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {shownName || "Nombre del negocio"}
          </p>
          <div className="mt-3 border-t border-dashed border-border/70" />
        </article>
      </div>
    </div>
  );
}

export default function GeneralSettingsPage() {
  const toast = useToast();
  const { data: settings, isLoading } = useSettings();
  const uploadLogo = useUploadLogo();
  const updateOrganizationName = useUpdateOrganizationName();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [syncedSettings, setSyncedSettings] = useState<typeof settings | null>(
    null,
  );

  // Render-phase sync: seed the editable name from the server snapshot and
  // re-seed only when a new snapshot arrives (no effect cascade). The same
  // snapshot seeds the baseline that decides whether there is anything to save.
  if (settings && settings !== syncedSettings) {
    setSyncedSettings(settings);
    setName(settings.organization.name ?? "");
  }

  if (isLoading || !settings) {
    return (
      <LoadingState
        icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
        message="Cargando configuración…"
      />
    );
  }

  const savedName = settings.organization.name ?? "";
  const isNameDirty = name !== savedName;
  const logoUrl = settings.organization.logoUrl;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadLogo.mutateAsync(file);
      toast.success("Logo actualizado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo subir el logo"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = organizationNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "Nombre no válido.");
      return;
    }
    setNameError(null);
    try {
      await updateOrganizationName.mutateAsync(parsed.data);
      toast.success("Nombre actualizado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar el nombre"));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          General
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Identidad visual y datos básicos del negocio
        </p>
      </div>

      <div className="@container">
        <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.6fr)] @4xl:gap-5">
          <section
            aria-label="Información del negocio"
            className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs"
          >
            <SettingsRow
              title="Nombre del negocio"
              description="Aparece en la cabecera de los comprobantes."
            >
              <form
                onSubmit={handleNameSubmit}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 sm:flex-1">
                  <Input
                    id="organization-name"
                    aria-label="Nombre del negocio"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                    aria-invalid={nameError ? true : undefined}
                    error={nameError ?? undefined}
                    placeholder="Nombre de tu negocio"
                  />
                </div>
                <Button
                  type="submit"
                  loading={updateOrganizationName.isPending}
                  disabled={!isNameDirty}
                  className="sm:shrink-0"
                >
                  Guardar
                </Button>
              </form>
            </SettingsRow>

            <SettingsRow
              title="Logo"
              description="Se imprime arriba del nombre, en la cabecera del comprobante."
              className="border-t border-border/60"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                <div
                  className={cn(
                    "flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/25",
                    logoUrl ? "border-border/70 p-2" : "border-dashed border-border/70",
                  )}
                >
                  {logoUrl ? (
                    <Image
                      src={logoUrl}
                      alt="Logo del negocio"
                      width={112}
                      height={112}
                      unoptimized
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                      <ImageIcon className="h-5 w-5" aria-hidden="true" />
                      <span className="text-xs font-medium">Sin logo</span>
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    aria-label="Logo del negocio"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    loading={uploadLogo.isPending}
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    {logoUrl ? "Reemplazar logo" : "Subir logo"}
                  </Button>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    PNG, JPG o WebP. Ideal una imagen horizontal de 288 × 96 px
                    o mayor.
                  </p>
                </div>
              </div>
            </SettingsRow>
          </section>

          <div className="@4xl:sticky @4xl:top-5">
            <ReceiptHeaderPreview name={name} logoUrl={logoUrl} />
          </div>
        </div>
      </div>

      <SettingsCard
        title="Apariencia"
        description="Elige el tema de la interfaz en este dispositivo."
        icon={<Palette className="h-4 w-4 text-primary" aria-hidden="true" />}
      >
        <ThemeSelector />
      </SettingsCard>

      <InstallAppCard />
    </div>
  );
}
