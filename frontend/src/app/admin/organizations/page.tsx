"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import {
  useOrganizations,
  useCreateOrganization,
  useUpdateOrganizationStatus,
  useUpdateOrganizationPlan,
} from "@/hooks/useAdmin";
import type { Organization } from "@/hooks/useAdmin";
import { formatDate } from "@/lib/utils";
import { Building2, Eye, Settings2 } from "lucide-react";
import {
  planLabels,
  planOptions,
  statusDot,
  statusLabel,
  statusOptions,
} from "./labels";

export default function OrganizationsPage() {
  const router = useRouter();
  const { data: organizations, isLoading, isError, refetch } = useOrganizations();
  const createOrg = useCreateOrganization();
  const updateStatus = useUpdateOrganizationStatus();
  const updatePlan = useUpdateOrganizationPlan();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [statusDraft, setStatusDraft] = useState("TRIAL");
  const [planDraft, setPlanDraft] = useState("BASIC");
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    plan: "BASIC",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    hasAdmin: false,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "El nombre es obligatorio";
    if (!formData.slug.trim()) errors.slug = "El slug es obligatorio";
    if (formData.slug.length < 3) errors.slug = "Mínimo 3 caracteres";
    if (formData.hasAdmin) {
      if (!formData.adminName.trim()) errors.adminName = "El nombre del admin es obligatorio";
      if (!formData.adminEmail.trim()) errors.adminEmail = "El email del admin es obligatorio";
      if (formData.adminPassword && formData.adminPassword.length < 6) errors.adminPassword = "Mínimo 6 caracteres";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const payload: Record<string, unknown> = {
      name: formData.name,
      slug: formData.slug,
      plan: formData.plan,
    };

    if (formData.hasAdmin) {
      payload.admin = {
        name: formData.adminName,
        email: formData.adminEmail,
        password: formData.adminPassword || undefined,
      };
    }

    try {
      await createOrg.mutateAsync(payload);
      setIsModalOpen(false);
      setFormData({
        name: "",
        slug: "",
        plan: "BASIC",
        adminName: "",
        adminEmail: "",
        adminPassword: "",
        hasAdmin: false,
      });
    } catch {
      // Error handled by mutation
    }
  };

  const openEdit = (organization: Organization) => {
    setEditing(organization);
    setStatusDraft(organization.status);
    setPlanDraft(organization.plan);
  };

  const handleSaveEdit = () => {
    if (!editing) {
      return;
    }

    if (statusDraft !== editing.status) {
      updateStatus.mutate({ id: editing.id, status: statusDraft });
    }
    if (planDraft !== editing.plan) {
      updatePlan.mutate({ id: editing.id, plan: planDraft });
    }
    setEditing(null);
  };

  const header = (
    <PageHeader
      title="Organizaciones"
      subtitle="Tenants del sistema"
      count={organizations ? organizations.length : undefined}
      actions={
        <Button onClick={() => setIsModalOpen(true)}>Crear organización</Button>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        <TableSkeleton rows={6} columns={6} label="Cargando organizaciones..." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState
          message="No se pudieron cargar las organizaciones."
          retryLabel="Reintentar"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      <Card>
        <CardContent className="p-0">
          {!organizations || organizations.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-4 w-4" />}
              title="No hay organizaciones"
              subtitle="Crea la primera con el botón Crear organización."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableCell as="th">Organización</TableCell>
                    <TableCell as="th">Estado</TableCell>
                    <TableCell as="th">Plan</TableCell>
                    <TableCell as="th" className="text-right">
                      Usuarios
                    </TableCell>
                    <TableCell as="th" className="text-right">
                      Creada
                    </TableCell>
                    <TableCell as="th" className="text-right">
                      Acciones
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <tbody>
                  {organizations.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">
                            {org.name}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {org.slug}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                          <span
                            aria-hidden="true"
                            className={statusDot[org.status] ?? "bg-slate-400"}
                            style={{ height: 6, width: 6, borderRadius: 9999 }}
                          />
                          {statusLabel(org.status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {planLabels[org.plan] ?? org.plan}
                      </TableCell>
                      <TableCell className="text-right font-mono text-foreground tabular-nums">
                        {org.userCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                        {formatDate(org.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <RowActions
                            label={`Acciones de ${org.name}`}
                            items={[
                              {
                                label: "Editar estado y plan",
                                icon: <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />,
                                onSelect: () => openEdit(org),
                              },
                              {
                                label: "Ver detalle",
                                icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />,
                                onSelect: () => router.push(`/admin/organizations/${org.id}`),
                              },
                            ]}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar organización"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{editing?.name}</p>
          <BentoSelect
            label="Estado"
            value={statusDraft}
            options={statusOptions}
            onChange={setStatusDraft}
          />
          <BentoSelect
            label="Plan"
            value={planDraft}
            options={planOptions}
            onChange={setPlanDraft}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              loading={updateStatus.isPending || updatePlan.isPending}
              onClick={handleSaveEdit}
            >
              Guardar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Crear organización"
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre de la organización"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            error={formErrors.name}
            required
          />
          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            error={formErrors.slug}
            required
          />
          <BentoSelect
            label="Plan"
            value={formData.plan}
            options={planOptions}
            onChange={(value) => setFormData({ ...formData, plan: value })}
          />

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="hasAdmin"
              checked={formData.hasAdmin}
              onChange={(e) => setFormData({ ...formData, hasAdmin: e.target.checked })}
              className="h-4 w-4 rounded border-border text-primary-text focus:ring-primary"
            />
            <label htmlFor="hasAdmin" className="text-sm font-medium text-foreground">
              Crear administrador inicial
            </label>
          </div>

          {formData.hasAdmin && (
            <div className="space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4">
              <Input
                label="Nombre del admin"
                value={formData.adminName}
                onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                error={formErrors.adminName}
                required={formData.hasAdmin}
              />
              <Input
                label="Email del admin"
                type="email"
                value={formData.adminEmail}
                onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                error={formErrors.adminEmail}
                required={formData.hasAdmin}
              />
              <Input
                label="Contraseña del admin"
                type="password"
                placeholder="Dejar vacío para generar automáticamente"
                minLength={10}
                value={formData.adminPassword}
                onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                error={formErrors.adminPassword}
              />
              <p className="text-xs text-muted-foreground">
                Si dejas este campo vacío, se generará una contraseña temporal automáticamente. Mínimo 10 caracteres.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createOrg.isPending}>
              {createOrg.isPending ? "Creando..." : "Crear"}
            </Button>
          </div>

          {createOrg.isError && (
            <p className="text-sm text-red-500">
              Error al crear la organización. Intenta de nuevo.
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
