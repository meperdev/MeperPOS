"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  useSettings,
  useUploadLogo,
  useUpdateOrganizationName,
} from "@/hooks/useSettings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { SettingsCard } from "../../_components/SettingsCard";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { Building2, Upload, Image as ImageIcon } from "lucide-react";

export default function GeneralSettingsPage() {
  const toast = useToast();
  const { data: settings, isLoading } = useSettings();
  const uploadLogo = useUploadLogo();
  const updateOrganizationName = useUpdateOrganizationName();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");

  useEffect(() => {
    if (settings) {
      setName(settings.organization.name ?? "");
    }
  }, [settings]);

  if (isLoading || !settings) {
    return (
      <LoadingState
        icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
        message="Cargando configuración..."
      />
    );
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadLogo.mutateAsync(file);
      toast.success("Logo actualizado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al subir el logo"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateOrganizationName.mutateAsync(name);
      toast.success("Nombre actualizado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al actualizar el nombre"));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          General
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Identidad visual y datos básicos del negocio
        </p>
      </div>

      <SettingsCard
        title="Información del negocio"
        description="Nombre y logo que aparecen en los comprobantes"
        icon={<Building2 className="w-4 h-4" />}
      >
        <div className="space-y-6">
          <form onSubmit={handleNameSubmit} className="space-y-3">
            <Input
              label="Nombre de la organización"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de tu negocio"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                loading={updateOrganizationName.isPending}
              >
                Guardar
              </Button>
            </div>
          </form>

          <div className="pt-4 border-t border-border/60">
            <p className="text-xs font-medium text-muted-foreground mb-2.5">
              Logo del negocio
            </p>
            <div className="flex items-center gap-3.5">
              {settings.organization.logoUrl ? (
                <div className="relative w-14 h-14 rounded-xl border border-border/70 overflow-hidden bg-muted/30">
                  <Image
                    src={settings.organization.logoUrl}
                    alt="Logo del negocio"
                    fill
                    sizes="56px"
                    className="object-contain p-1"
                  />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-xl border border-dashed border-border/70 bg-muted/20 flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
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
                <Upload className="w-3.5 h-3.5" /> Subir logo
              </Button>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
