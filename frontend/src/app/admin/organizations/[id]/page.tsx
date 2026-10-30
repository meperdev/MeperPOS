"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  useOrganization,
  useUpdateOrganizationStatus,
  useUpdateOrganizationPlan,
  useUpdateOrganization,
  useAddOrganizationMember,
  useUpdateMemberRole,
  useRemoveOrganizationMember,
  useDeleteOrganization,
} from "@/hooks/useAdmin";
import type { Organization } from "@/hooks/useAdmin";
import { formatDate } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api";
import {
  ArrowLeft,
  Building2,
  Users,
  CreditCard,
  FileText,
  Phone,
  MapPin,
  Trash2,
  UserPlus,
  ShieldAlert,
} from "lucide-react";

const statusOptions = [
  { value: "TRIAL", label: "Trial" },
  { value: "ACTIVE", label: "Activa" },
  { value: "PAST_DUE", label: "Vencida" },
  { value: "SUSPENDED", label: "Suspendida" },
];

const planOptions = [
  { value: "BASIC", label: "Básico" },
  { value: "PRO", label: "Pro" },
];

const statusBadgeVariant: Record<string, "warning" | "success" | "danger" | "default"> = {
  TRIAL: "warning",
  ACTIVE: "success",
  PAST_DUE: "danger",
  SUSPENDED: "danger",
};

const roleOptions = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "CASHIER", label: "Cashier" },
  { value: "INVENTORY_USER", label: "Inventario" },
];

export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: org, isLoading } = useOrganization(id);
  const updateStatus = useUpdateOrganizationStatus();
  const updatePlan = useUpdateOrganizationPlan();
  const updateOrg = useUpdateOrganization();
  const addMember = useAddOrganizationMember();
  const updateMemberRole = useUpdateMemberRole();
  const removeMember = useRemoveOrganizationMember();
  const deleteOrg = useDeleteOrganization();

  const [showAddMember, setShowAddMember] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [newMember, setNewMember] = useState({ email: "", name: "", role: "CASHIER" });
  const [addMemberError, setAddMemberError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  if (isLoading) {
    return <LoadingState icon={<Building2 className="w-5 h-5 text-primary/50" />} message="Cargando organización..." />;
  }

  if (!org) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Organización no encontrada</p>
        <Button variant="outline" onClick={() => router.push("/admin/organizations")}>
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/organizations")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-foreground">{org.name}</h2>
          <p className="text-sm text-muted-foreground">{org.slug}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <OrganizationGeneralCard
          key={org.updatedAt}
          organization={org}
          saving={updateOrg.isPending}
          onSave={(values) => updateOrg.mutate({ id: org.id, ...values })}
        />

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-foreground">Acciones</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cambiar Estado
              </label>
              <BentoSelect
                value={org.status}
                options={statusOptions}
                onChange={(value) => updateStatus.mutate({ id: org.id, status: value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cambiar Plan
              </label>
              <BentoSelect
                value={org.plan}
                options={planOptions}
                onChange={(value) => updatePlan.mutate({ id: org.id, plan: value })}
              />
            </div>
            <div className="border-t border-border pt-4">
              <Button
                variant="danger"
                size="sm"
                className="w-full"
                onClick={() => {
                  setDeleteConfirmName("");
                  setDeleteError("");
                  setShowDelete(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Eliminar organización
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary-text" />
              <h3 className="text-lg font-semibold text-foreground">Usuarios de la organización</h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNewMember({ email: "", name: "", role: "CASHIER" });
                setAddMemberError("");
                setShowAddMember(true);
              }}
            >
              <UserPlus className="h-4 w-4" />
              Añadir miembro
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {org.users && org.users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Nombre</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Email</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Rol</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Owner</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {org.users.map(
                    (ou: {
                      id: string;
                      role: string;
                      isPrimaryOwner: boolean;
                      joinedAt: string;
                      user: {
                        id: string;
                        name: string;
                        email: string;
                        active: boolean;
                      };
                    }) => (
                      <tr key={ou.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {ou.user.name}
                          {ou.isPrimaryOwner && (
                            <ShieldAlert className="ml-2 inline h-4 w-4 text-amber-500" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{ou.user.email}</td>
                        <td className="px-4 py-3">
                          <BentoSelect
                            value={ou.role}
                            options={roleOptions}
                            onChange={(value) =>
                              updateMemberRole.mutate({
                                orgId: org.id,
                                userId: ou.user.id,
                                role: value,
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          {ou.isPrimaryOwner ? (
                            <Badge variant="success">Sí</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={ou.isPrimaryOwner}
                            title={
                              ou.isPrimaryOwner
                                ? "No se puede remover al propietario"
                                : "Remover miembro"
                            }
                            onClick={() =>
                              removeMember.mutate({
                                orgId: org.id,
                                userId: ou.user.id,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Users className="h-8 w-8" />} title="No hay usuarios en esta organización" />
          )}
        </CardContent>
      </Card>

      {/* Add Member Modal */}
      <Modal
        isOpen={showAddMember}
        onClose={() => setShowAddMember(false)}
        title="Añadir miembro"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            placeholder="correo@ejemplo.com"
            value={newMember.email}
            onChange={(e) =>
              setNewMember((prev) => ({ ...prev, email: e.target.value }))
            }
          />
          <Input
            label="Nombre (opcional)"
            value={newMember.name}
            onChange={(e) =>
              setNewMember((prev) => ({ ...prev, name: e.target.value }))
            }
          />
          <BentoSelect
            label="Rol"
            value={newMember.role}
            options={roleOptions}
            onChange={(value) =>
              setNewMember((prev) => ({ ...prev, role: value }))
            }
          />
          {addMemberError && (
            <p className="text-sm text-red-500">{addMemberError}</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowAddMember(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={addMember.isPending}
              onClick={() => {
                if (!newMember.email) {
                  setAddMemberError("El email es requerido");
                  return;
                }
                addMember.mutate(
                  {
                    id: org.id,
                    email: newMember.email,
                    name: newMember.name || undefined,
                    role: newMember.role,
                  },
                  {
                    onSuccess: () => setShowAddMember(false),
                    onError: (err) =>
                      setAddMemberError(getApiErrorMessage(err, "Error al añadir miembro")),
                  },
                );
              }}
            >
              Añadir
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        title="Eliminar organización"
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-8 w-8 text-red-600" />
              <div>
                <p className="font-semibold text-red-700 dark:text-red-400">
                  Esta acción es irreversible
                </p>
                <p className="text-sm text-red-600 dark:text-red-300">
                  Todos los datos de la organización serán eliminados permanentemente,
                  incluyendo productos, ventas, clientes y usuarios.
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Escribe <strong>{org.name}</strong> para confirmar:
          </p>

          <Input
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={org.name}
          />

          {deleteError && (
            <p className="text-sm text-red-500">{deleteError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={deleteOrg.isPending}
              disabled={deleteConfirmName !== org.name}
              onClick={() => {
                if (deleteConfirmName !== org.name) {
                  setDeleteError("El nombre no coincide");
                  return;
                }
                deleteOrg.mutate(
                  { id: org.id, confirmOrganizationName: deleteConfirmName },
                  {
                    onSuccess: () => router.push("/admin/organizations"),
                    onError: (err) =>
                      setDeleteError(getApiErrorMessage(err, "Error al eliminar")),
                  },
                );
              }}
            >
              Eliminar permanentemente
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

type OrganizationFormValues = {
  name: string;
  slug: string;
  taxId: string;
  phone: string;
  address: string;
};

/**
 * The editable half of the organization detail card. Its state starts from the
 * loaded organization; the parent keys it by `updatedAt`, so a refetch after a
 * save re-seeds the form without an effect writing state during render.
 */
function OrganizationGeneralCard({
  organization,
  saving,
  onSave,
}: {
  organization: Organization;
  saving: boolean;
  onSave: (values: OrganizationFormValues) => void;
}) {
  const [form, setForm] = useState<OrganizationFormValues>(() => ({
    name: organization.name,
    slug: organization.slug,
    taxId: organization.taxId ?? "",
    phone: organization.phone ?? "",
    address: organization.address ?? "",
  }));

  const update = (key: keyof OrganizationFormValues, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <h3 className="text-lg font-semibold text-foreground">Información General</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre" value={form.name} onChange={(e) => update("name", e.target.value)} />
          <Input label="Slug" value={form.slug} onChange={(e) => update("slug", e.target.value)} />
          <Input label="NIT" value={form.taxId} onChange={(e) => update("taxId", e.target.value)} />
          <Input label="Teléfono" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Dirección" value={form.address} onChange={(e) => update("address", e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" loading={saving} onClick={() => onSave(form)}>
            Guardar cambios
          </Button>
          {organization.trialEndsAt && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                Trial finaliza: {formatDate(organization.trialEndsAt)}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Building2 className="h-4 w-4 text-primary-text" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Estado</p>
              <Badge variant={statusBadgeVariant[organization.status] ?? "default"}>
                {organization.status}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <CreditCard className="h-4 w-4 text-primary-text" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Plan</p>
              <p className="text-sm font-semibold text-foreground">{organization.plan}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Facturación</p>
            <p className="text-sm font-semibold text-foreground">{organization.billingStatus ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Creada</p>
            <p className="text-sm font-semibold text-foreground">{formatDate(organization.createdAt)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
