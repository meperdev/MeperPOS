"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useCustomers, useCreateCustomer, useUpdateCustomer, useDeleteCustomer } from "@/hooks/useCustomers";
import type { CustomerPayload } from "@/hooks/useCustomers";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Pagination } from "@/components/ui/Pagination";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FilterBar,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import { cn } from "@/lib/utils";
import {
  Plus,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Users,
  Pencil,
  ShoppingBag,
  Bookmark,
  Bike,
} from "lucide-react";
import type { Customer } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";

const segmentConfig: Record<string, { variant: "success" | "warning" | "default" | "danger"; label: string }> = {
  VIP:        { variant: "success", label: "VIP" },
  FREQUENT:   { variant: "warning", label: "Frecuente" },
  OCCASIONAL: { variant: "default", label: "Ocasional" },
  INACTIVE:   { variant: "danger",  label: "Inactivo" },
};

function CustomerAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-9 h-9 rounded-lg bg-muted/60 border border-border/70 flex items-center justify-center shrink-0">
      <span className="font-mono text-xs font-semibold text-foreground tracking-tight">
        {initials}
      </span>
    </div>
  );
}

export default function CustomersPage() {
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const canCreate = hasAnyRole(user?.role, ["ADMIN", "CASHIER"]);
  const canEdit = hasAnyRole(user?.role, ["ADMIN"]);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("");
  const [viewMode, setViewMode] = usePersistedViewMode("customers");
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerPayload>({});

  const { data, isLoading } = useCustomers({ page, limit: viewMode === "grid" ? 12 : 10, search: search || undefined, segment: segment || undefined });
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  const customers = data?.data ?? [];
  const meta = data?.meta;

  const handleEdit = (customer: Customer) => {
    if (!canEdit) return;
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      documentType: customer.documentType,
      documentNumber: customer.documentNumber,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      referencia: customer.referencia,
      placaMoto: customer.placaMoto,
      segment: customer.segment,
      active: customer.active,
    });
    setShowModal(true);
  };

  const handleCreate = () => {
    if (!canCreate) return;
    setEditingCustomer(null);
    setFormData({ name: "", documentType: "CC", documentNumber: "", email: "", phone: "", address: "", referencia: "", placaMoto: "", segment: "OCCASIONAL" });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (!canEdit) return;
    setCustomerToDelete(id);
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    if (customerToDelete) {
      try {
        await deleteCustomer.mutateAsync(customerToDelete);
        toast.success("Cliente eliminado correctamente");
        setShowConfirmModal(false);
        setCustomerToDelete(null);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "No se pudo eliminar el cliente"));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await updateCustomer.mutateAsync({ id: editingCustomer.id, data: formData });
        toast.success("Cliente actualizado correctamente");
      } else {
        await createCustomer.mutateAsync(formData);
        toast.success("Cliente creado correctamente");
      }
      setShowModal(false);
      setFormData({});
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al guardar el cliente"));
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-5">

        {/* Page Header */}
<PageHeader
          title="Clientes"
          subtitle="Gestiona tu cartera de clientes"
          count={meta ? `${meta.total} registros` : undefined}
          actions={
            canCreate ? (
              <Button onClick={handleCreate} className="w-full sm:w-auto">
                <Plus className="w-4 h-4" /> Nuevo cliente
              </Button>
            ) : undefined
          }
        />

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={(val) => {
            setPage(1);
            setSearch(val);
          }}
          searchPlaceholder="Buscar por nombre, documento o teléfono..."
          filterControls={
            <>
              <FilterGroup label="Segmento">
                {[
                  { value: "", label: "Todos" },
                  { value: "VIP", label: "VIP" },
                  { value: "FREQUENT", label: "Frecuente" },
                  { value: "OCCASIONAL", label: "Ocasional" },
                  { value: "INACTIVE", label: "Inactivo" },
                ].map(({ value, label }) => (
                  <FilterOptionButton
                    key={value}
                    active={segment === value}
                    onClick={() => {
                      setPage(1);
                      setSegment(value);
                    }}
                  >
                    {label}
                  </FilterOptionButton>
                ))}
              </FilterGroup>
              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => {
                  setPage(1);
                  setViewMode(mode);
                }}
              />
            </>
          }
        />

        {/* Content */}
        {isLoading ? (
          <TableSkeleton columns={5} rows={8} label="Cargando clientes..." />
        ) : customers.length === 0 ? (
          <EmptyState icon={<Users className="w-5 h-5 text-muted-foreground" />} title="No hay clientes" subtitle="Agrega tu primer cliente" />
        ) : (
          <>
            {viewMode === "grid" ? (
              <div className="grid flex-1 content-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 stagger-children">
                {customers.map((customer) => {
                  const seg = segmentConfig[customer.segment] || segmentConfig.OCCASIONAL;
                  const hasOptionalContact = Boolean(
                    customer.email ||
                      customer.phone ||
                      customer.address ||
                      customer.referencia ||
                      customer.placaMoto,
                  );
                  return (
                    <div
                      key={customer.id}
                      className={cn(
                        "group flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors duration-150",
                        "hover:border-border",
                        canEdit && "cursor-pointer",
                      )}
                      onClick={canEdit ? () => handleEdit(customer) : undefined}
                    >
                      <div>
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <CustomerAvatar name={customer.name} />
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-foreground truncate leading-tight">
                                {customer.name}
                              </h3>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground font-mono tabular-nums">
                                <span>{customer.documentType}</span>
                                <span>·</span>
                                <span className="text-foreground/90 font-medium truncate">
                                  {customer.documentNumber}
                                </span>
                              </div>
                            </div>
                          </div>
                          <Badge variant={seg.variant} className="shrink-0">
                            {seg.label}
                          </Badge>
                        </div>

                        {/* Details */}
                        <div className="mt-3 border-t border-border/50 pt-2.5 min-h-[4.25rem]">
                          {!hasOptionalContact ? (
                            <p className="text-xs text-muted-foreground/70">
                              Sin datos de contacto adicionales
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {(customer.phone || customer.placaMoto) && (
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                  {customer.phone ? (
                                    <span className="inline-flex items-center gap-1.5 min-w-0">
                                      <Phone className="w-3.5 h-3.5 shrink-0" />
                                      <span className="font-mono text-foreground/90 tabular-nums truncate">
                                        {customer.phone}
                                      </span>
                                    </span>
                                  ) : (
                                    <span />
                                  )}
                                  {customer.placaMoto && (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground uppercase tracking-tight shrink-0">
                                      <Bike className="w-3 h-3 text-muted-foreground shrink-0" />
                                      {customer.placaMoto}
                                    </span>
                                  )}
                                </div>
                              )}
                              {customer.email && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Mail className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">{customer.email}</span>
                                </div>
                              )}
                              {customer.address && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">{customer.address}</span>
                                </div>
                              )}
                              {customer.referencia && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Bookmark className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">Ref: {customer.referencia}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div
                        className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            router.push(
                              `/sales?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}`,
                            )
                          }
                        >
                          <ShoppingBag className="h-3 w-3" /> Ver historial
                        </Button>

                        {canEdit && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEdit(customer)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/60 hover:text-foreground"
                              aria-label={`Editar ${customer.name}`}
                              title="Editar cliente"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(customer.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                              aria-label={`Eliminar ${customer.name}`}
                              title="Eliminar cliente"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden animate-fade-in flex-1">
                <div className="overflow-x-auto">
                  <Table variant="default" className="min-w-[680px]">
                    <TableHeader>
                      <TableRow>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Cliente
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Documento
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Contacto
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Placa / Ref
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Segmento
                        </TableCell>
                        <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                          Acciones
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {customers.map((customer) => {
                        const seg = segmentConfig[customer.segment] || segmentConfig.OCCASIONAL;
                        return (
                          <TableRow
                            key={customer.id}
                            onClick={canEdit ? () => handleEdit(customer) : undefined}
                            className={cn(canEdit && "cursor-pointer")}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2.5 min-w-0">
                                <CustomerAvatar name={customer.name} />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-foreground truncate max-w-[180px]">
                                    {customer.name}
                                  </p>
                                  {customer.address && (
                                    <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                                      {customer.address}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                              <span className="text-muted-foreground mr-1.5">
                                {customer.documentType}
                              </span>
                              <span className="font-semibold text-foreground">
                                {customer.documentNumber}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5 text-xs">
                                {customer.phone && (
                                  <p className="font-mono text-foreground tabular-nums">
                                    {customer.phone}
                                  </p>
                                )}
                                {customer.email && (
                                  <p className="text-muted-foreground truncate max-w-[160px]">
                                    {customer.email}
                                  </p>
                                )}
                                {!customer.phone && !customer.email && (
                                  <span className="text-muted-foreground/60">—</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {customer.placaMoto && (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground uppercase">
                                    <Bike className="w-3 h-3 text-muted-foreground" />
                                    {customer.placaMoto}
                                  </span>
                                )}
                                {customer.referencia && (
                                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                    Ref: {customer.referencia}
                                  </span>
                                )}
                                {!customer.placaMoto && !customer.referencia && (
                                  <span className="text-xs text-muted-foreground/60">—</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={seg.variant}>{seg.label}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div
                                className="flex items-center justify-end gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    router.push(
                                      `/sales?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}`,
                                    )
                                  }
                                >
                                  <ShoppingBag className="h-3 w-3" /> Historial
                                </Button>
                                {canEdit && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleEdit(customer)}
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/60 hover:text-foreground"
                                      aria-label={`Editar ${customer.name}`}
                                      title="Editar cliente"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(customer.id)}
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                                      aria-label={`Eliminar ${customer.name}`}
                                      title="Eliminar cliente"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>
            )}

            {meta && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                itemLabel="cliente"
              />
            )}
          </>
        )}
      </div>

      <Modal isOpen={canCreate && showModal} onClose={() => setShowModal(false)} title={editingCustomer ? "Editar cliente" : "Nuevo cliente"} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Nombre" value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="sm:col-span-2" />
            <BentoSelect label="Tipo de Documento" value={formData.documentType || "CC"} onChange={(value) => setFormData({ ...formData, documentType: value })} options={[{ value: "CC", label: "Cédula de Ciudadanía" }, { value: "NIT", label: "NIT" }, { value: "CE", label: "Cédula de Extranjería" }, { value: "TI", label: "Tarjeta de Identidad" }]} />
            <Input label="Número de Documento" value={formData.documentNumber || ""} onChange={(e) => setFormData({ ...formData, documentNumber: e.target.value })} required />
            <Input label="Teléfono" value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            <Input label="Email" type="email" value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            <Input label="Dirección" value={formData.address || ""} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
            <BentoSelect label="Segmento" value={formData.segment || "OCCASIONAL"} onChange={(value) => setFormData({ ...formData, segment: value as Customer["segment"] })} options={[{ value: "OCCASIONAL", label: "Ocasional" }, { value: "FREQUENT", label: "Frecuente" }, { value: "VIP", label: "VIP" }, { value: "INACTIVE", label: "Inactivo" }]} />
            <Input label="Referencia" value={formData.referencia || ""} onChange={(e) => setFormData({ ...formData, referencia: e.target.value })} />
            <Input label="Placa de la moto" value={formData.placaMoto || ""} onChange={(e) => setFormData({ ...formData, placaMoto: e.target.value })} />
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-end pt-3.5 border-t border-border/60">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="w-full sm:w-auto">Cancelar</Button>
            <Button type="submit" loading={createCustomer.isPending || updateCustomer.isPending} className="w-full sm:w-auto">{editingCustomer ? "Actualizar" : "Crear"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog isOpen={canEdit && showConfirmModal} onClose={() => setShowConfirmModal(false)} onConfirm={confirmDelete} title="Eliminar cliente" message="¿Estás seguro? Esta acción no se puede deshacer." confirmText="Eliminar" cancelText="Cancelar" />
    </DashboardLayout>
  );
}
