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
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SiteAssignmentModal } from "@/components/locations/SiteAssignmentModal";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { Building2, KeyRound, Plus, Shield, SquarePen, Trash2, Users as UsersIcon } from "lucide-react";
import type { User } from "@/types";

// Only the current OrgRole values are offered (S1: ADMIN, CASHIER,
// INVENTORY_USER).
type SelectableRole = "ADMIN" | "CASHIER" | "INVENTORY_USER";

const DEFAULT_ROLE: SelectableRole = "CASHIER";

const roleLabel: Record<User["role"], string> = {
  ADMIN: "Administrador",
  CASHIER: "Cajero",
  INVENTORY_USER: "Inventario",
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  // Creating an ADMIN needs the primary owner or a SUPER_ADMIN (the API answers
  // 403 to anyone else), so only they are offered the option.
  const canCreateAdmin =
    currentUser?.isPrimaryOwner === true ||
    currentUser?.isSuperAdmin === true ||
    currentUser?.role === "SUPER_ADMIN";
  // The same people manage admin-rank accounts (edit, deactivate, reset,
  // remove); anyone else gets 403, so those actions are hidden from them.
  const mayManage = (target: User) =>
    canCreateAdmin ||
    !(target.isPrimaryOwner === true || target.role === "ADMIN");
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
  const [userToAssignSites, setUserToAssignSites] = useState<User | null>(null);
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
    });
    setShowEditModal(true);
  };

  return (
    <div>
      <div className="space-y-4">
        <PageHeader
          title="Usuarios"
          count={`${users.length} ${users.length === 1 ? "miembro" : "miembros"}`}
          subtitle="Administración centralizada de usuarios y accesos"
          actions={
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4" /> Nuevo usuario
            </Button>
          }
        />

        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
          <div className="border-b border-border/60 px-4 py-3 flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="text-sm font-semibold text-foreground">
              Listado de usuarios
            </h3>
          </div>

          <div className="p-4">
            {isLoading ? (
              <LoadingState
                icon={<UsersIcon className="w-4 h-4 text-muted-foreground" />}
                message="Cargando usuarios…"
              />
            ) : users.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="w-5 h-5 text-muted-foreground" />}
                title="No hay usuarios registrados."
              />
            ) : (
              <div className="@container divide-y divide-border/60">
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
                      className="flex flex-col gap-3 py-3.5 @2xl:flex-row @2xl:items-center @2xl:justify-between"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-muted/60 border border-border/70 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-foreground">
                            {initials}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {user.name}
                          </p>
                          <p className="truncate text-[13px] text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 @2xl:shrink-0 @2xl:justify-end">
                        {/* An older API may omit `role`; an icon-only badge would read as broken. */}
                        {user.role && (
                          <Badge variant="default">
                            <Shield className="mr-1 h-3 w-3 text-muted-foreground" />
                            {user.isPrimaryOwner ? "Propietario" : roleLabel[user.role] || user.role}
                          </Badge>
                        )}
                        <Badge variant={user.active ? "success" : "danger"} dot>
                          {user.active ? "Activo" : "Inactivo"}
                        </Badge>
                        {(user.id === currentUser?.id || mayManage(user)) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`${user.active ? "Desactivar" : "Activar"} usuario ${user.name}`}
                            onClick={() => handleToggleActive(user.id)}
                            disabled={
                              user.id === currentUser?.id || toggleUserActive.isPending
                            }
                          >
                            {user.active ? "Desactivar" : "Activar"}
                          </Button>
                        )}
                        {user.id !== currentUser?.id && (
                          <>
                            {mayManage(user) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                aria-label={`Editar usuario ${user.name}`}
                                onClick={() => openEditModal(user)}
                              >
                                <SquarePen className="h-3.5 w-3.5" /> Editar
                              </Button>
                            )}
                            {/* The dialog asks the server whether this person
                                already reaches every site; the list carries no role. */}
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Sedes de ${user.name}`}
                              onClick={() => setUserToAssignSites(user)}
                            >
                              <Building2 className="h-3.5 w-3.5" /> Sedes
                            </Button>
                            {mayManage(user) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-9 w-9 px-0"
                                aria-label={`Restablecer contraseña de ${user.name}`}
                                onClick={() => {
                                  setUserToReset(user);
                                  setShowResetModal(true);
                                  setNewPassword("");
                                }}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {mayManage(user) && (
                              <Button
                                size="sm"
                                variant="danger"
                                className="h-9 w-9 px-0"
                                aria-label={`Eliminar usuario ${user.name}`}
                                onClick={() => {
                                  setUserToDelete(user.id);
                                  setShowDeleteModal(true);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
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
            {/* No role here: `PUT /users/:id` accepts only name and email and
                rejects any other property, and no endpoint changes a role yet. */}
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
          <PasswordInput label="Contraseña" minLength={10} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} showStrength required />
          <p className="text-[13px] text-muted-foreground">Mínimo 10 caracteres</p>
          <Select
            label="Rol"
            value={formData.role}
            onChange={(value) => setFormData({ ...formData, role: value as SelectableRole })}
            options={[
              { value: "CASHIER", label: "Cajero" },
              { value: "INVENTORY_USER", label: "Inventario" },
              ...(canCreateAdmin ? [{ value: "ADMIN", label: "Administrador" }] : []),
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
            <p className="text-[13px] text-muted-foreground">
              Usuario: <span className="font-semibold text-foreground">{userToReset.name}</span>
            </p>
            <PasswordInput
              label="Nueva contraseña"
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              showStrength
              required
            />
            <p className="text-[13px] text-muted-foreground">Mínimo 10 caracteres</p>
            <div className="flex justify-end gap-3 border-t border-border/60 pt-4">
              <Button type="button" variant="secondary" onClick={() => setShowResetModal(false)}>Cancelar</Button>
              <Button type="submit" loading={resetPassword.isPending}>Guardar</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Mounted only while open: the dialog reads the site directory, and the
          team screen has no reason to fetch sites until someone asks. */}
      {userToAssignSites && (
        <SiteAssignmentModal
          isOpen
          onClose={() => setUserToAssignSites(null)}
          user={userToAssignSites}
        />
      )}

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
