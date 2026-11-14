"use client";

import { useSettings } from "@/hooks/useSettings";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SettingsCard } from "../../_components/SettingsCard";
import { Globe2 } from "lucide-react";

export default function LocaleSettingsPage() {
  const { data: settings, isLoading, isError, refetch } = useSettings();

  if (isError && !settings) {
    return (
      <ErrorState
        message="No se pudo cargar la configuración."
        retryLabel="Reintentar"
        onRetry={refetch}
      />
    );
  }

  if (isLoading || !settings) {
    return (
      <LoadingState
        icon={<Globe2 className="w-4 h-4 text-muted-foreground" />}
        message="Cargando configuración..."
      />
    );
  }

  const items = [
    { label: "Moneda", value: settings.locale.currency },
    { label: "Región (locale)", value: settings.locale.locale },
    { label: "Zona horaria", value: settings.locale.timezone },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          Moneda y región
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Valores fijos definidos por la plataforma
        </p>
      </div>

      <SettingsCard
        title="Moneda y formato regional"
        description="Valores fijos de la plataforma (solo lectura)"
        icon={<Globe2 className="w-4 h-4" />}
      >
        <dl className="divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/20">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between px-3.5 py-2.5"
            >
              <dt className="text-xs font-medium text-muted-foreground">
                {item.label}
              </dt>
              <dd className="font-mono text-xs font-semibold text-foreground tabular-nums">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsCard>
    </div>
  );
}
