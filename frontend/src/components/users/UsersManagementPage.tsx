"use client";

import { useState } from "react";
import {
  useCreateUser,
  useDeleteUser,
  useResetUserPassword,
  useToggleUserActive,
  useUpdateUser,
  useUsers,
} from "@/hooks/useUsers";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { KeyRound, Plus, Shield, SquarePen, Trash2, Users as UsersIcon } from "lucide-react";
import type { User } from "@/types";

type SelectableRole = "ADMIN" | "CASHIER" | "INVENTORY_USER";

const SELECTABLE_ROLES: SelectableRole[] = ["ADMIN", "CASHIER", "INVENTORY_USER"];
const DEFAULT_ROLE: SelectableRole = "CASHIER";

function toSelectableRole(role: User["role"]): SelectableRole {
  return SELECTABLE_ROLES.includes(role as SelectableRole)
    ? (role as SelectableRole)
    : DEFAULT_ROLE;
}

const roleLabel: Record<User["role"], string> = {
  ADMIN: "Administrador",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
  MEMBER: "Miembro",
  OWNER: "Propietario",
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const { data: users = [], isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const toggleUserActive = useToggleUserActive();
  const resetPassword = useResetUserPassword();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: DEFAULT_ROLE,
  });
  const [editFormData, setEditFormData] = useState({
    name: "",
    email: "",
    role: DEFAULT_ROLE,
  });

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      await createUser.mutateAsync(formData);
      toast.success("Usuario creado correctamente");
      setShowCreateModal(false);
      setFormData({ name: "", email: "", password: "", role: DEFAULT_ROLE });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo crear el usuario"));
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) {
      return;
    }

    try {
      await deleteUser.mutateAsync(userToDelete);
      toast.success("Usuario eliminado correctamente");
      setShowDeleteModal(false);
      setUserToDelete(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo eliminar el usuario"));
    }
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!userToEdit) {
      return;
    }

    try {
      await updateUser.mutateAsync({
        id: userToEdit.id,
        data: editFormData,
      });
      toast.success("Usuario actualizado correctamente");
      setShowEditModal(false);
      setUserToEdit(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar el usuario"));
    }
  };

  const handleToggleActive = async (id: string) => {
    try {
      await toggleUserActive.mutateAsync(id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar el estado"));
    }
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userToReset || newPassword.length < 8) {
      return;
    }

    try {
      await resetPassword.mutateAsync({ userId: userToReset.id, newPassword });
      toast.success("Contraseña restablecida exitosamente");
      setShowResetModal(false);
      setUserToReset(null);
      setNewPassword("");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo restablecer la contraseña"));
    }
  };

  const openEditModal = (user: User) => {
    setUserToEdit(user);
    setEditFormData({
      name: user.name,
      email: user.email,
      role: toSelectableRole(user.role),
    });
    setShowEditModal(true);
  };

  return (
    <div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                Usuarios
              </h1>
              <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                {users.length} {users.length === 1 ? "miembro" : "miembros"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Administración centralizada de usuarios y accesos
            </p>
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4" /> Nuevo usuario
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
          <div className="border-b border-border/60 px-4 py-3 flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="text-xs sm:text-sm font-semibold text-foreground">
              Listado de usuarios
            </h3>
          </div>

          <div className="p-4">
            {isLoading ? (
              <LoadingState
                icon={<UsersIcon className="w-4 h-4 text-muted-foreground" />}
                message="Cargando usuarios..."
              />
            ) : users.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="w-5 h-5 text-muted-foreground" />}
                title="No hay usuarios registrados."
              />
            ) : (
              <div className="space-y-2">
                {users.map((user) => {
                  const initials = user.name
                    .split(" ")
                    .filter(Boolean)
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <div
                      key={user.id}
                      className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 transition-colors hover:border-border sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-muted/60 border border-border/70 flex items-center justify-center shrink-0">
                          <span className="font-mono text-xs font-semibold text-foreground tracking-tight">
                            {initials}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs sm:text-sm font-semibold text-foreground">
                            {user.name}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default">
                          <Shield className="mr-1 h-3 w-3 text-muted-foreground" />
                          {roleLabel[user.role] || user.role}
                        </Badge>
                        <Badge variant={user.active ? "success" : "danger"} dot>
                          {user.active ? "Activo" : "Inactivo"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleToggleActive(user.id)}
                          disabled={
                            user.id === currentUser?.id || toggleUserActive.isPending
                          }
                        >
                          {user.active ? "Desactivar" : "Activar"}
                        </Button>
                        {user.id !== currentUser?.id && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Editar usuario ${user.name}`}
                              onClick={() => openEditModal(user)}
                            >
                              <SquarePen className="h-3.5 w-3.5" /> Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Restablecer contraseña de ${user.name}`}
                              onClick={() => {
                                setUserToReset(user);
                                setShowResetModal(true);
                                setNewPassword("");
                              }}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              aria-label={`Eliminar usuario ${user.name}`}
                              onClick={() => {
                                setUserToDelete(user.id);
                                setShowDeleteModal(true);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Editar usuario" size="lg">
        {userToEdit && (
          <form onSubmit={handleEdit} className="space-y-4">
            <Input label="Nombre" value={editFormData.name} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} required />
            <Input label="Correo" type="email" value={editFormData.email} onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })} required />
            <BentoSelect
              label="Rol"
              value={editFormData.role}
              onChange={(value) => setEditFormData({ ...editFormData, role: value as SelectableRole })}
              options={[
                { value: "CASHIER", label: "Cajero" },
                { value: "INVENTORY_USER", label: "Inventario" },
                { value: "ADMIN", label: "Administrador" },
              ]}
            />
            <div className="flex justify-end gap-3 border-t border-border/60 pt-4">
              <Button type="button" variant="secondary" onClick={() => setShowEditModal(false)}>Cancelar</Button>
              <Button type="submit" loading={updateUser.isPending}>Guardar cambios</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Crear usuario" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Nombre" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
          <Input label="Correo" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
          <Input label="Contraseña" type="password" minLength={10} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
          <p className="text-xs text-muted-foreground">Mínimo 10 caracteres</p>
          <BentoSelect
            label="Rol"
            value={formData.role}
            onChange={(value) => setFormData({ ...formData, role: value as SelectableRole })}
            options={[
              { value: "CASHIER", label: "Cajero" },
              { value: "INVENTORY_USER", label: "Inventario" },
              { value: "ADMIN", label: "Administrador" },
            ]}
          />
          <div className="flex justify-end gap-3 border-t border-border/60 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
            <Button type="submit" loading={createUser.isPending}>Crear</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showResetModal} onClose={() => setShowResetModal(false)} title="Restablecer contraseña" size="sm">
        {userToReset && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Usuario: <span className="font-semibold text-foreground">{userToReset.name}</span>
            </p>
            <Input
              label="Nueva contraseña"
              type="password"
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Mínimo 10 caracteres</p>
            <div className="flex justify-end gap-3 border-t border-border/60 pt-4">
              <Button type="button" variant="secondary" onClick={() => setShowResetModal(false)}>Cancelar</Button>
              <Button type="submit" loading={resetPassword.isPending}>Guardar</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Eliminar usuario"
        message="Esta acción no se puede deshacer."
        confirmText="Eliminar"
        cancelText="Cancelar"
      />
    </div>
  );
}
