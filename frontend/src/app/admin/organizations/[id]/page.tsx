"use client";

import { use, useRef, useState } from "react";
import { OrganizationModulesCard } from "./organization-modules-card";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
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
import { useToast } from "@/contexts/ToastContext";
import {
  planLabels,
  planOptions,
  statusLabel,
  statusOptions,
  statusTone,
} from "../labels";
import {
  ArrowLeft,
  Building2,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

const roleOptions = [
  { value: "OWNER", label: "Propietario" },
  { value: "ADMIN", label: "Administrador" },
  { value: "MEMBER", label: "Miembro" },
  { value: "CASHIER", label: "Cajero" },
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
  const toast = useToast();

  const [showAddMember, setShowAddMember] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  // ConfirmDialog closes itself once `onConfirm` resolves, so a failed removal
  // consumes one close and leaves the dialog up: the toast carries the reason
  // and the reader decides again (retry or Cancelar).
  const keepRemovalDialogOpen = useRef(false);
  const [newMember, setNewMember] = useState({ email: "", name: "", role: "CASHIER" });
  const [addMemberError, setAddMemberError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  if (isLoading) {
    return <LoadingState icon={<Building2 className="w-5 h-5 text-primary/50" />} message="Cargando organización…" />;
  }

  if (!org) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">Organización no encontrada</p>
        <Button variant="secondary" onClick={() => router.push("/admin/organizations")}>
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
      </div>
    );
  }

  const members = org.users ?? [];
  type OrgMember = (typeof members)[number];

  const renderRole = (ou: OrgMember) => (
    <Select
      value={ou.role}
      options={roleOptions}
      onChange={(value) =>
        updateMemberRole.mutate({
          orgId: org.id,
          userId: ou.user.id,
          role: value,
        })
      }
      className="w-40 [&>button]:h-8"
    />
  );

  const renderOwner = (ou: OrgMember) =>
    ou.isPrimaryOwner ? (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
        Sí
      </span>
    ) : (
      <span className="text-[13px] text-muted-foreground">—</span>
    );

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;
    try {
      await removeMember.mutateAsync({ orgId: org.id, userId: memberToRemove.userId });
    } catch (error) {
      keepRemovalDialogOpen.current = true;
      toast.error(getApiErrorMessage(error, "No se pudo quitar el miembro"));
    }
  };

  const renderMemberActions = (ou: OrgMember) => (
    <RowActions
      label={`Acciones de ${ou.user.name}`}
      items={[
        {
          label: "Quitar",
          icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
          destructive: true,
          disabled: ou.isPrimaryOwner,
          hint: ou.isPrimaryOwner
            ? "El propietario no se puede quitar"
            : undefined,
          onSelect: () =>
            setMemberToRemove({ userId: ou.user.id, name: ou.user.name }),
        },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Volver a organizaciones"
          className="-ml-1 mt-0.5 h-8 w-8 shrink-0 p-0"
          onClick={() => router.push("/admin/organizations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          className="min-w-0 flex-1"
          title={org.name}
          count={org.plan}
          subtitle={org.slug}
          actions={
            <Badge variant={statusTone[org.status] ?? "default"} dot>
              {statusLabel(org.status)}
            </Badge>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <OrganizationGeneralCard
          key={org.updatedAt}
          organization={org}
          saving={updateOrg.isPending}
          onSave={(values) => updateOrg.mutate({ id: org.id, ...values })}
        />

        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-foreground">Acciones</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Cambiar estado
              </label>
              <Select
                value={org.status}
                options={statusOptions}
                onChange={(value) => updateStatus.mutate({ id: org.id, status: value })}
                className="[&>button]:h-8"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Cambiar plan
              </label>
              <Select
                value={org.plan}
                options={planOptions}
                onChange={(value) => updatePlan.mutate({ id: org.id, plan: value })}
                className="[&>button]:h-8"
              />
            </div>
            <div className="border-t border-border/70 pt-4">
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

      <OrganizationModulesCard organizationId={org.id} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">
                Usuarios de la organización
              </h3>
              <span className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[13px] text-muted-foreground tabular-nums">
                {members.length}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setNewMember({ email: "", name: "", role: "CASHIER" });
                setAddMemberError("");
                setShowAddMember(true);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Añadir miembro
            </Button>
          </div>
        </CardHeader>
        <CardContent className="@container p-0">
          {members.length > 0 ? (
            <>
              <div className="hidden @3xl:block overflow-x-auto">
                <Table className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell as="th">Usuario</TableCell>
                      <TableCell as="th">Rol</TableCell>
                      <TableCell as="th">Propietario</TableCell>
                      <TableCell as="th" className="text-right">
                        Acciones
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {members.map((ou) => (
                      <TableRow key={ou.id}>
                        <TableCell>
                          <p className="text-sm font-medium text-foreground">{ou.user.name}</p>
                          <p className="mt-0.5 id-text text-[13px] text-muted-foreground">
                            {ou.user.email}
                          </p>
                        </TableCell>
                        <TableCell>{renderRole(ou)}</TableCell>
                        <TableCell>{renderOwner(ou)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">{renderMemberActions(ou)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div data-testid="org-member-list" className="@3xl:hidden divide-y divide-border/60">
                {members.map((ou) => (
                  <div key={ou.id} data-testid="org-member-row" className="px-4 py-3 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground break-words">{ou.user.name}</p>
                        <p className="mt-0.5 id-text text-[13px] text-muted-foreground break-all">
                          {ou.user.email}
                        </p>
                      </div>
                      <div className="shrink-0">{renderMemberActions(ou)}</div>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-[13px]">
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Rol</dt>
                        <dd>{renderRole(ou)}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-muted-foreground">Propietario</dt>
                        <dd>{renderOwner(ou)}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Users className="h-4 w-4" />}
              title="No hay usuarios en esta organización"
            />
          )}
        </CardContent>
      </Card>

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
            onChange={(e) => setNewMember((prev) => ({ ...prev, email: e.target.value }))}
          />
          <Input
            label="Nombre (opcional)"
            value={newMember.name}
            onChange={(e) => setNewMember((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Select
            label="Rol"
            value={newMember.role}
            options={roleOptions}
            onChange={(value) => setNewMember((prev) => ({ ...prev, role: value }))}
          />
          {addMemberError && <p className="text-sm text-danger-text">{addMemberError}</p>}
          <div className="flex justify-end gap-2 pt-2">
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
                      setAddMemberError(getApiErrorMessage(err, "No se pudo añadir el miembro")),
                  },
                );
              }}
            >
              Añadir
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        title="Eliminar organización"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
            <ShieldAlert className="h-5 w-5 shrink-0 text-danger-text" />
            <div>
              <p className="text-sm font-medium text-danger-text">
                Esta acción es irreversible
              </p>
              <p className="mt-1 text-[13px] text-danger-text">
                Todos los datos de la organización serán eliminados permanentemente,
                incluyendo productos, ventas, clientes y usuarios.
              </p>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground">
            Escribe <strong className="font-semibold text-foreground">{org.name}</strong> para confirmar:
          </p>

          <Input
            label="Nombre de la organización"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={org.name}
          />

          {deleteError && <p className="text-sm text-danger-text">{deleteError}</p>}

          <div className="flex justify-end gap-2 pt-2">
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
                      setDeleteError(getApiErrorMessage(err, "No se pudo eliminar la organización")),
                  },
                );
              }}
            >
              Eliminar permanentemente
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={memberToRemove !== null}
        onClose={() => {
          if (keepRemovalDialogOpen.current) {
            keepRemovalDialogOpen.current = false;
            return;
          }
          setMemberToRemove(null);
        }}
        onConfirm={handleRemoveMember}
        title="Quitar miembro"
        message={`${memberToRemove?.name ?? ""} perderá el acceso a ${org.name}.`}
        confirmText="Quitar"
      />
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

  const metadata = [
    { label: "Estado", value: statusLabel(organization.status) },
    { label: "Plan", value: planLabels[organization.plan] ?? organization.plan },
    { label: "Facturación", value: organization.billingStatus ?? "—" },
    { label: "Creada", value: formatDate(organization.createdAt) },
  ];

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <h3 className="text-sm font-medium text-foreground">Información general</h3>
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

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" loading={saving} onClick={() => onSave(form)}>
            Guardar cambios
          </Button>
          {organization.trialEndsAt && (
            <span className="rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-[13px] text-muted-foreground tabular-nums">
              Trial finaliza: {formatDate(organization.trialEndsAt)}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-4">
          {metadata.map((item) => (
            <div key={item.label}>
              <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
              <dd className="mt-0.5 truncate text-[13px] text-foreground tabular-nums">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
