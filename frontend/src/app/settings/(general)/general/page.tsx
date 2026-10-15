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
import { InstallAppCard } from "../../_components/InstallAppCard";
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
        icon={<Building2 className="w-5 h-5 text-primary/50" />}
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
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 rounded-full bg-primary shrink-0" />
        <h2 className="text-xl font-bold text-foreground">General</h2>
      </div>

      <SettingsCard
        title="Información del negocio"
        description="Nombre y logo que aparecen en los comprobantes"
        icon={<Building2 className="w-4 h-4 text-primary" />}
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

          <div className="pt-4 border-t border-black/5 dark:border-white/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground mb-3">
              Logo del negocio
            </p>
            <div className="flex items-center gap-4">
              {settings.organization.logoUrl ? (
                <div className="relative w-16 h-16 rounded-2xl border border-primary/30 overflow-hidden bg-background/60">
                  <Image
                    src={settings.organization.logoUrl}
                    alt="Logo del negocio"
                    fill
                    sizes="64px"
                    className="object-contain"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-2xl border border-dashed border-primary/30 bg-background/60 flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-primary/50" />
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

      <InstallAppCard />
    </div>
  );
}
