"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Sun,
  Moon,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
} from "lucide-react";

const emptySubscribe = () => () => {};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [showSupportModal, setShowSupportModal] = useState(false);

  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const { login, loading } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isDark = mounted && theme === "dark";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    // Reconcile credentials directly from the DOM form elements in case
    // browser autofill or a password manager filled them without dispatching
    // a synthetic React onChange event.
    const form = e.currentTarget;
    const emailInput = form.elements.namedItem("email") as HTMLInputElement | null;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement | null;

    const resolvedEmail = (emailInput?.value || email || "").trim();
    const resolvedPassword = passwordInput?.value || password || "";

    if (resolvedEmail !== email) {
      setEmail(resolvedEmail);
    }
    if (resolvedPassword !== password) {
      setPassword(resolvedPassword);
    }

    if (!resolvedEmail) {
      setError("Por favor ingresa tu correo electrónico.");
      emailInput?.focus();
      return;
    }

    if (!resolvedPassword) {
      setError("Por favor ingresa tu contraseña.");
      passwordInput?.focus();
      return;
    }

    try {
      await login(resolvedEmail, resolvedPassword);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "Credenciales incorrectas. Verifica tu correo y contraseña."
        )
      );
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background selection:bg-primary/20 selection:text-primary-text">
      {/* Barra superior: ecosistema MeperSoft + tema */}
      <header className="flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <div className="flex items-center gap-2.5">
          <Image
            src="/brand/mepersoft-icon-192.png"
            alt="MeperSoft logo"
            width={192}
            height={192}
            className="h-8 w-8 shrink-0 object-contain"
            priority
          />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Meper<span className="text-[#0F766E] dark:text-[#00B392]">Soft</span>
          </span>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          suppressHydrationWarning
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isDark ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10 sm:py-12">
        <div className="w-full max-w-[27rem]">
          {/* Lockup vertical: emblema + marca */}
          <div
            data-testid="login-form-emblem"
            className="mb-8 flex flex-col items-center text-center"
          >
            <Image
              src="/brand/login-icon.png"
              alt={`${APP_NAME} emblema oficial Lucky`}
              width={512}
              height={512}
              className="mb-4 h-28 w-28 object-contain sm:h-32 sm:w-32"
              priority
            />
            <div className="text-4xl font-semibold leading-none tracking-tight text-foreground sm:text-[42px]">
              Meper<span className="text-[#B45309] dark:text-[#FF9933]">POS</span>
            </div>
            <div className="mt-3 h-1.5 w-11 rounded-full bg-[#FF9933]" />
          </div>

          {/* Encabezado del formulario */}
          <div className="mb-6 space-y-1.5">
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              <span>Acceso al sistema</span>
            </div>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              Iniciar sesión
            </h1>
            <p className="pt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Ingresa tus credenciales autorizadas para comenzar tu turno.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3.5 text-xs font-medium text-rose-700 dark:text-rose-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <Input
              id="email"
              name="email"
              type="email"
              label="Correo Electrónico"
              placeholder="usuario@negocio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => setEmail(e.target.value.trim())}
              required
              autoComplete="username email"
              icon={<Mail className="h-4 w-4" />}
            />

            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              label="Contraseña"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              icon={<Lock className="h-4 w-4" />}
              suffixIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Ver contraseña"
                  }
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
            />

            <Button
              type="submit"
              disabled={loading}
              loading={loading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 text-sm font-semibold"
            >
              <span>Ingresar al Sistema</span>
              {!loading && (
                <span className="flex items-center gap-1.5 opacity-90">
                  <ArrowRight className="h-4 w-4" />
                  <kbd className="hidden items-center rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px] leading-none text-white dark:bg-black/20 sm:inline-flex">
                    ↵ Enter
                  </kbd>
                </span>
              )}
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-4 text-xs">
            <span className="text-muted-foreground">
              ¿Problemas para acceder a tu turno?
            </span>
            <button
              type="button"
              onClick={() => setShowSupportModal(true)}
              className="inline-flex min-h-7 items-center gap-1 font-semibold text-primary-text underline underline-offset-2 transition-colors hover:text-primary-dark"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              <span>Ayuda y soporte</span>
            </button>
          </div>
        </div>
      </main>

      <footer className="px-6 pb-6 sm:px-10 sm:pb-8">
        <div className="flex flex-col items-center justify-between gap-2 border-t border-border/60 pt-4 text-center font-mono text-[11px] text-muted-foreground/70 sm:flex-row sm:text-left">
          <span>
            &copy; {new Date().getFullYear()} {APP_NAME} — Plataforma POS para negocios en Colombia.
          </span>
          <a
            href="https://folio.mepersoft.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-7 items-center gap-1 font-medium text-primary-text underline underline-offset-2 transition-colors hover:text-primary-dark"
          >
            <span>folio.mepersoft.app</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </footer>

      {/* ─── Modal de Ayuda y Soporte de Acceso ─── */}
      <Modal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        title="Ayuda y Soporte de Acceso"
        size="sm"
      >
        <div className="space-y-4 text-xs sm:text-sm text-foreground p-1">
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border/70">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary-text flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              <p className="font-semibold text-foreground">
                Acceso restringido por organización
              </p>
              <p className="mt-0.5 text-muted-foreground/90">
                El registro público está en pausa. Las cuentas de cajero, inventario y
                administración son creadas exclusivamente por el titular de tu negocio.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="font-bold text-foreground flex items-center gap-1.5 text-xs sm:text-sm">
              <CheckCircle2 className="w-4 h-4 text-primary-text shrink-0" />
              ¿Cómo obtengo credenciales de acceso?
            </h4>
            <p className="text-muted-foreground text-xs leading-relaxed">
              El registro autónomo de nuevos usuarios está deshabilitado temporalmente.
              Las cuentas son generadas internamente por el propietario o administrador de
              tu punto de venta desde la sección de <strong>Usuarios</strong>.
            </p>
          </div>

          <div className="space-y-1.5">
            <h4 className="font-bold text-foreground flex items-center gap-1.5 text-xs sm:text-sm">
              <CheckCircle2 className="w-4 h-4 text-primary-text shrink-0" />
              ¿Olvidaste tu contraseña?
            </h4>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Solicita al administrador de tu tienda que restablezca tu contraseña o te
              asigne una nueva clave temporal desde su panel.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-muted/60 border border-border/80 text-xs text-muted-foreground space-y-1.5">
            <p className="font-semibold text-foreground">
              ¿Eres propietario y requieres habilitar tu negocio?
            </p>
            <p>Escribe directamente al equipo de aprovisionamiento de MeperPOS:</p>
            <p className="font-mono text-primary-text font-bold text-xs pt-0.5">
              soporte@meperpos.com
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

          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setShowSupportModal(false)}
            >
              Entendido
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
