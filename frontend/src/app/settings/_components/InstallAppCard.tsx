"use client";

import { useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SettingsCard } from "./SettingsCard";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { APP_NAME } from "@/lib/constants";

/**
 * Offers installation on the device the operator is holding, and renders
 * nothing at all when the platform cannot install the app or already has.
 *
 * The two branches are not stylistic: Chromium owns its install UI and only
 * needs a button to replay the captured prompt, while WebKit has no
 * programmatic install at all and can only be told where the Share sheet is.
 */
export function InstallAppCard() {
  const { isAvailable, canPromptInstall, promptInstall } = useInstallPrompt();
  const [isPrompting, setIsPrompting] = useState(false);

  if (!isAvailable) return null;

  const handleInstall = async () => {
    setIsPrompting(true);
    try {
      await promptInstall();
    } finally {
      setIsPrompting(false);
    }
  };

  return (
    <SettingsCard
      title="Instalar la aplicación"
      description={`Usa ${APP_NAME} desde el inicio, sin la barra del navegador`}
      icon={<Download className="w-4 h-4 text-primary" aria-hidden="true" />}
    >
      {canPromptInstall ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Instala {APP_NAME} en este dispositivo para abrirlo a pantalla
            completa.
          </p>
          <Button size="sm" onClick={handleInstall} loading={isPrompting}>
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Instalar
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            En iPhone y iPad la instalación se hace desde Safari:
          </p>
          <ol className="space-y-2 text-xs text-foreground">
            <li className="flex gap-2">
              <span className="font-semibold text-primary">1.</span>
              <span>
                Toca el botón <Share
                  className="inline w-3.5 h-3.5 text-primary align-text-bottom"
                  aria-hidden="true"
                />{" "}
                Compartir en la barra de Safari.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-primary">2.</span>
              <span>Desplázate y elige &quot;Añadir a pantalla de inicio&quot;.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-primary">3.</span>
              <span>Confirma con &quot;Añadir&quot;.</span>
            </li>
          </ol>
        </div>
      )}
    </SettingsCard>
  );
}
