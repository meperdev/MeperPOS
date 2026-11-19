"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/constants";
import { ArrowLeft, ExternalLink } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))] sm:pl-[max(1.5rem,var(--safe-left))] sm:pr-[max(1.5rem,var(--safe-right))] sm:pt-[max(1.5rem,var(--safe-top))] sm:pb-[max(1.5rem,var(--safe-bottom))] selection:bg-primary/20 selection:text-primary-text">
      <div className="w-full max-w-md">
        <div className="rounded-2xl p-8 sm:p-10 bg-card border border-border/80 space-y-6 text-left">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-border/60">
            <div className="flex items-center">
              <Image
                src="/brand/meperpos-lockup-on-light-384.png"
                alt={`${APP_NAME} logo`}
                width={384}
                height={247}
                className="w-36 h-auto block dark:hidden"
              />
              <Image
                src="/brand/meperpos-lockup-on-dark-384.png"
                alt={`${APP_NAME} logo`}
                width={384}
                height={247}
                className="w-36 h-auto hidden dark:block"
              />
            </div>
          </div>

          {/* Contexto y Explicación */}
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight">
              Creación de cuentas por invitación
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
              El registro autónomo de nuevos usuarios está en pausa. Las cuentas de
              cajero, inventario y administración son creadas exclusivamente por el
              <strong> Administrador o Propietario</strong> desde su panel de gestión en Bucaramanga y Colombia.
            </p>
          </div>

          {/* Callout informativo */}
          <div className="bg-muted/40 rounded-lg p-4 text-xs text-muted-foreground space-y-1.5">
            <p className="font-semibold text-foreground">
              ¿Requieres acceso para tu turno?
            </p>
            <p className="leading-relaxed">
              Contacta al administrador del sistema o escribe a{" "}
              <span className="id-text text-primary-text font-semibold">
                soporte@meperpos.com
              </span>
            </p>
            <div className="pt-1.5 border-t border-border/60 text-[11px] flex items-center gap-1 text-muted-foreground">
              <span>Portafolio y referencias:</span>
              <a
                href="https://folio.mepersoft.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-text font-medium hover:underline inline-flex items-center gap-1"
              >
                folio.mepersoft.app
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>

          <Button
            type="button"
            className="w-full h-11 text-sm font-semibold flex items-center justify-center gap-2"
            onClick={() => router.push("/login")}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver al inicio de sesión</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
