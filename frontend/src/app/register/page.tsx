"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/constants";
import { ArrowLeft, ShieldAlert, ExternalLink } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center p-4 sm:p-6 selection:bg-primary/20 selection:text-primary">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="rounded-3xl p-8 sm:p-10 bg-card border border-border/80 shadow-2xl shadow-black/10 space-y-6 text-left">
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
            <div className="font-mono text-[11px] uppercase font-bold text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
              Acceso Restringido
            </div>
          </div>

          {/* Contexto y Explicación */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-primary text-xs font-mono font-bold uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4 text-terracotta" />
              <span>Registro Institucional</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-foreground tracking-tight">
              Creación de cuentas por invitación
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed">
              El registro autónomo de nuevos usuarios está en pausa. Las cuentas de
              cajero, inventario y administración son creadas exclusivamente por el
              <strong> Administrador o Propietario</strong> desde su panel de gestión en Bucaramanga y Colombia.
            </p>
          </div>

          {/* Callout informativo */}
          <div className="bg-muted/40 border border-border/80 rounded-2xl p-4 text-xs text-muted-foreground space-y-1.5">
            <p className="font-semibold text-foreground">
              ¿Requieres acceso para tu turno?
            </p>
            <p className="leading-relaxed">
              Contacta al administrador del sistema o escribe a{" "}
              <span className="font-mono text-primary font-bold">
                soporte@meperpos.com
              </span>
            </p>
            <div className="pt-1.5 border-t border-border/60 text-[11px] flex items-center gap-1 text-muted-foreground">
              <span>Portafolio y referencias:</span>
              <a
                href="https://folio.mepersoft.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline inline-flex items-center gap-1"
              >
                folio.mepersoft.app
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>

          <Button
            type="button"
            className="w-full h-11 text-sm font-bold shadow-md flex items-center justify-center gap-2"
            onClick={() => router.push("/login")}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver al Inicio de Sesión</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
