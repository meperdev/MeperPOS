"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { LoadingState } from "@/components/ui/LoadingState";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import {
  useOrganizations,
  useCreateOrganization,
  useUpdateOrganizationStatus,
  useUpdateOrganizationPlan,
} from "@/hooks/useAdmin";
import { formatDate } from "@/lib/utils";
import { Building2, Eye } from "lucide-react";

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

export default function OrganizationsPage() {
  const router = useRouter();
  const { data: organizations, isLoading } = useOrganizations();
  const createOrg = useCreateOrganization();
  const updateStatus = useUpdateOrganizationStatus();
  const updatePlan = useUpdateOrganizationPlan();

  const [isModalOpen, setIsModalOpen] = useState(false);
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

  if (isLoading) {
    return <LoadingState icon={<Building2 className="w-5 h-5 text-primary/50" />} message="Cargando organizaciones..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Organizaciones</h2>
        <Button onClick={() => setIsModalOpen(true)}>
          <Building2 className="h-4 w-4" />
          Crear organización
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table variant="default" className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Nombre</TableCell>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Slug</TableCell>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Estado</TableCell>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Plan</TableCell>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Usuarios</TableCell>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Creada</TableCell>
                  <TableCell as="th" className="px-4 py-3 text-left font-semibold text-foreground">Acciones</TableCell>
                </TableRow>
              </TableHeader>
              <tbody>
                {organizations?.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="px-4 py-3 font-medium text-foreground">{org.name}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{org.slug}</TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant={statusBadgeVariant[org.status] ?? "default"}>
                        {org.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <BentoSelect
                        value={org.plan}
                        options={planOptions}
                        onChange={(value) => updatePlan.mutate({ id: org.id, plan: value })}
                        className="w-32 py-1.5 text-xs"
                      />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{org.userCount}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{formatDate(org.createdAt)}</TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/admin/organizations/${org.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <BentoSelect
                          value={org.status}
                          options={statusOptions}
                          onChange={(value) => updateStatus.mutate({ id: org.id, status: value })}
                          className="w-32 py-1.5 text-xs"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </div>
        </CardContent>
      </Card>

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
            <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
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
