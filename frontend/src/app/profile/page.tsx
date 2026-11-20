"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateProfile, useChangePassword, useProfile } from "@/hooks/useProfile";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { User as UserIcon, Lock, Mail, Shield } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";

export default function ProfilePage() {
  const toast = useToast();
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();

  const currentUser = profile || user;

  const [formData, setFormData] = useState({
    name: currentUser?.name || "",
    email: currentUser?.email || "",
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync(formData);
      toast.success("Perfil actualizado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar el perfil"));
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    if (passwordData.newPassword.length < 10) {
      toast.error("La contraseña debe tener al menos 10 caracteres");
      return;
    }
    try {
      await changePassword.mutateAsync({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Contraseña cambiada correctamente");
    } catch (error) {
      toast.error(
        getApiErrorMessage(
          error,
          "No se pudo cambiar la contraseña. Verifica tu contraseña actual."
        )
      );
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        {/* The profile's own shape: the summary card, then the two cards that
            hold personal data and credentials. */}
        <div aria-busy="true" className="space-y-4 lg:space-y-5">
          <CardSkeleton
            count={1}
            label="Cargando perfil…"
            className="grid-cols-1"
            cardClassName="min-h-[80px]"
          />
          <CardSkeleton
            count={2}
            label=""
            className="lg:grid-cols-2"
            cardClassName="min-h-[260px]"
          />
        </div>
      </DashboardLayout>
    );
  }

  const initials =
    currentUser?.name
      ?.split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  const roleLabel: Record<string, string> = {
    SUPER_ADMIN: "Super Admin",
    OWNER: "Propietario",
    ADMIN: "Administrador",
    MEMBER: "Miembro",
    CASHIER: "Cajero",
    INVENTORY_USER: "Inventario",
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        {/* Header */}
        <PageHeader
          title="Mi perfil"
          subtitle="Gestiona tu información personal y credenciales de acceso"
        />

        {/* Top Summary Card */}
        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-lg bg-muted/60 border border-border/70 text-foreground flex items-center justify-center font-semibold text-sm shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-foreground truncate">
                {currentUser?.name}
              </h2>
              <p className="text-[13px] text-muted-foreground truncate">
                {currentUser?.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="default">
              <Shield className="mr-1 w-3 h-3 text-muted-foreground" />
              {roleLabel[currentUser?.role || ""] || currentUser?.role}
            </Badge>
            <Badge variant="success" dot>
              Activo
            </Badge>
          </div>
        </div>

        {/* 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
          {/* Column 1: Datos Personales */}
          <div className="rounded-xl border border-border/70 bg-card p-4 sm:p-5 shadow-2xs space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <h3 className="text-sm sm:text-sm font-semibold text-foreground">
                    Información personal
                  </h3>
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Actualiza tu nombre visible y correo en el sistema
                </p>
              </div>

              <form id="profile-form" onSubmit={handleProfileUpdate} className="space-y-3">
                <Input
                  label="Nombre completo"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Tu nombre completo"
                  icon={<UserIcon className="w-4 h-4" />}
                  required
                />

                <Input
                  label="Correo electrónico"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="correo@empresa.com.co"
                  icon={<Mail className="w-4 h-4" />}
                  type="email"
                  required
                />
              </form>
            </div>

            <div className="flex justify-end pt-3 border-t border-border/60">
              <Button
                type="submit"
                form="profile-form"
                loading={updateProfile.isPending}
                className="w-full sm:w-auto"
              >
                Guardar cambios
              </Button>
            </div>
          </div>

          {/* Column 2: Seguridad y Contraseña */}
          <div className="rounded-xl border border-border/70 bg-card p-4 sm:p-5 shadow-2xs space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                  <h3 className="text-sm sm:text-sm font-semibold text-foreground">
                    Seguridad y contraseña
                  </h3>
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Mínimo 10 caracteres. Evita contraseñas comunes.
                </p>
              </div>

              <form id="password-form" onSubmit={handlePasswordChange} className="space-y-3">
                <PasswordInput
                  label="Contraseña actual"
                  value={passwordData.currentPassword}
                  onChange={(e) =>
                    setPasswordData({ ...passwordData, currentPassword: e.target.value })
                  }
                  placeholder="••••••••••••"
                  icon={<Lock className="w-4 h-4" />}
                  autoComplete="current-password"
                  required
                />

                <PasswordInput
                  label="Nueva contraseña"
                  value={passwordData.newPassword}
                  onChange={(e) =>
                    setPasswordData({ ...passwordData, newPassword: e.target.value })
                  }
                  placeholder="••••••••••••"
                  icon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                  showStrength
                  required
                />

                <PasswordInput
                  label="Confirmar nueva contraseña"
                  value={passwordData.confirmPassword}
                  onChange={(e) =>
                    setPasswordData({ ...passwordData, confirmPassword: e.target.value })
                  }
                  placeholder="••••••••••••"
                  icon={<Lock className="w-4 h-4" />}
                  autoComplete="new-password"
                  required
                />
              </form>
            </div>

            <div className="flex justify-end pt-3 border-t border-border/60">
              <Button
                type="submit"
                form="password-form"
                variant="secondary"
                loading={changePassword.isPending}
                className="w-full sm:w-auto"
              >
                Actualizar contraseña
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
