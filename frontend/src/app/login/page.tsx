"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PosIsometricShowcase } from "@/components/auth/PosIsometricShowcase";
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
  Receipt,
  Package,
  TrendingUp,
  HandCoins,
  Wallet,
  ClipboardCheck,
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
    <div className="min-h-screen w-full bg-background grid grid-cols-1 lg:grid-cols-12 selection:bg-primary/20 selection:text-primary">
      {/* ─── Columna Izquierda: Vitrina y Contexto Operativo (Desktop) ─── */}
      <div className="hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between p-10 xl:p-16 border-r border-border/80 relative overflow-hidden bg-card/40">
        {/* Patrón arquitectónico sutil (cero neón, textura limpia) */}
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.20] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Gradientes ambientales sutiles de fondo */}

        {/* Marca superior: Ecosistema MeperSoft (Kiroi) */}
        <div className="relative z-10 flex items-center gap-3">
          <Image
            src="/brand/mepersoft-icon-192.png"
            alt="MeperSoft logo"
            width={192}
            height={192}
            className="w-10 h-10 xl:w-11 xl:h-11 shrink-0 object-contain drop-shadow-xs"
            priority
          />
          <span className="text-xl xl:text-2xl font-semibold tracking-tight text-foreground leading-none">
            Meper
            <span className="text-[#00B392] underline decoration-[#00B392] decoration-[2.5px] underline-offset-[5px]">
              Soft
            </span>
          </span>
        </div>

        {/* Escena visual isométrica + leve información operativa */}
        <div className="relative z-10 flex flex-col items-center justify-center my-auto py-6 space-y-5">
          <PosIsometricShowcase />

          <div className="text-center max-w-lg space-y-2.5">
            <p className="text-sm xl:text-base font-semibold text-foreground/90 tracking-tight">
              Control contable, existencias y caja para tu negocio.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-mono text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-background/60">
                <Receipt className="w-3.5 h-3.5 text-muted-foreground" />
                POS & Tirilla
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-background/60">
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
                Stock & Lotes
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-background/60">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                Reportes & Margen Real
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-background/60">
                <HandCoins className="w-3.5 h-3.5 text-muted-foreground" />
                Préstamos
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-background/60">
                <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
                Gastos & Salidas
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-background/60">
                <ClipboardCheck className="w-3.5 h-3.5 text-muted-foreground" />
                Tareas en Equipo
              </span>
            </div>
          </div>
        </div>

        {/* Pie de estado del sistema */}
        <div className="relative z-10 flex items-center justify-between text-xs text-muted-foreground border-t border-border/60 pt-4 font-mono">
          <span>Bucaramanga • es-CO</span>
          <span className="flex items-center gap-1.5 text-foreground/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Terminal Operativo Seguro
          </span>
        </div>
      </div>

      {/* ─── Columna Derecha: Formulario de Acceso ─── */}
      <div className="col-span-1 lg:col-span-6 xl:col-span-5 flex flex-col justify-between p-6 sm:p-10 lg:p-12 xl:p-16 relative">
        {/* Barra superior de utilidades (Toggle de tema) */}
        <div className="flex items-center justify-between lg:justify-end w-full">
          {/* Marca del ecosistema visible en móvil */}
          <div className="lg:hidden flex items-center gap-2.5">
            <Image
              src="/brand/mepersoft-icon-192.png"
              alt="MeperSoft logo"
              width={192}
              height={192}
              className="w-9 h-9 shrink-0 object-contain drop-shadow-xs"
              priority
            />
            <span className="text-xl font-semibold tracking-tight text-foreground leading-none">
              Meper
              <span className="text-[#00B392] underline decoration-[#00B392] decoration-[2.5px] underline-offset-[4px]">
                Soft
              </span>
            </span>
          </div>

          {/* Theme switch button */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"
            }
            title={
              isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"
            }
            suppressHydrationWarning
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border/60 transition-colors"
          >
            {isDark ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Contenedor central del formulario */}
        <div className="w-full max-w-sm sm:max-w-md mx-auto my-auto py-6">
          {/* Lockup vertical protagonista encima del login (estilo lámina oficial) */}
          <div
            data-testid="login-form-emblem"
            className="flex flex-col items-center text-center mb-8"
          >
            <Image
              src="/brand/login-icon.png"
              alt={`${APP_NAME} emblema oficial Lucky`}
              width={512}
              height={512}
              className="w-28 h-28 sm:w-32 sm:h-32 object-contain drop-shadow-lg mb-3.5"
              priority
            />
            <div className="text-4xl sm:text-[42px] font-semibold tracking-tight text-foreground leading-none">
              Meper<span className="text-[#FF9933]">POS</span>
            </div>
            <div className="w-11 h-1.5 rounded-full bg-[#FF9933] mt-2.5" />
          </div>

          {/* Encabezado del formulario */}
          <div className="space-y-1.5 mb-6 text-left">
            <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-xs font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              <span>Acceso al Sistema</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight leading-none">
              Iniciar sesión
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed pt-0.5">
              Ingresa tus credenciales autorizadas para comenzar tu turno.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-lg text-xs font-medium bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-300 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
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
              icon={<Mail className="w-4 h-4" />}
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
              icon={<Lock className="w-4 h-4" />}
              suffixIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Ver contraseña"
                  }
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              }
            />

            <Button
              type="submit"
              disabled={loading}
              loading={loading}
              className="w-full h-11 text-sm font-bold shadow-md hover:shadow-lg transition-all mt-2 flex items-center justify-center gap-2"
            >
              <span>Ingresar al Sistema</span>
              {!loading && (
                <span className="flex items-center gap-1.5 opacity-90">
                  <ArrowRight className="w-4 h-4" />
                  <kbd className="hidden sm:inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/20 dark:bg-black/20 text-white leading-none">
                    ↵ Enter
                  </kbd>
                </span>
              )}
            </Button>
          </form>

          {/* ─── Soporte de Acceso ─── */}
          <div className="mt-6 pt-5 border-t border-border/70 flex items-center justify-between text-xs px-1">
            <span className="text-muted-foreground">
              ¿Problemas para acceder a tu turno?
            </span>
            <button
              type="button"
              onClick={() => setShowSupportModal(true)}
              className="font-semibold text-primary hover:text-primary-dark transition-colors inline-flex items-center gap-1 underline underline-offset-2"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Ayuda y soporte</span>
            </button>
          </div>
        </div>

        {/* Micro pie legal en la columna derecha con link de referencia */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground/70 font-mono text-center sm:text-left">
          <span>
            &copy; {new Date().getFullYear()} {APP_NAME} — Plataforma POS para negocios en Colombia.
          </span>
          <a
            href="https://folio.mepersoft.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/90 hover:text-primary transition-colors inline-flex items-center gap-1 font-medium underline underline-offset-2"
          >
            <span>folio.mepersoft.app</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* ─── Modal de Ayuda y Soporte de Acceso ─── */}
      <Modal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        title="Ayuda y Soporte de Acceso"
        size="sm"
      >
        <div className="space-y-4 text-xs sm:text-sm text-foreground p-1">
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border/70">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
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
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
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
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
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
            <p className="font-mono text-primary font-bold text-xs pt-0.5">
              soporte@meperpos.com
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
