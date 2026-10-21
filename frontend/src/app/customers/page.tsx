"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useCustomers, useCreateCustomer, useUpdateCustomer, useDeleteCustomer } from "@/hooks/useCustomers";
import type { CustomerPayload } from "@/hooks/useCustomers";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { cn } from "@/lib/utils";
import { chipStyles } from "@/lib/chipStyles";
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

const segmentConfig: Record<string, { variant: "success" | "warning" | "default" | "danger"; label: string; color: string }> = {
  VIP:       { variant: "success", label: "VIP",       color: "#10b981" },
  FREQUENT:  { variant: "warning", label: "Frecuente", color: "#f59e0b" },
  OCCASIONAL:{ variant: "default", label: "Ocasional", color: "#64748b" },
  INACTIVE:  { variant: "danger",  label: "Inactivo",  color: "#ef4444" },
};

function CustomerAvatar({ name }: { name: string }) {
  const initials = name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-primary" style={{ fontFamily: "var(--font-manrope, sans-serif)" }}>
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
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerPayload>({});

  const { data, isLoading } = useCustomers({ page, limit: 20, search: search || undefined, segment: segment || undefined });
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
      <div className="space-y-5 lg:space-y-7">

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-1 h-7 rounded-full bg-accent shrink-0" />
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Clientes</h1>
              {meta && (
                <span
                  className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${chipStyles.accent}`}
                >
                  {meta.total} registros
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-4">Gestiona tu cartera de clientes</p>
          </div>
          {canCreate && (
            <Button onClick={handleCreate} className="w-full sm:w-auto shrink-0">
              <Plus className="w-4 h-4" /> Nuevo Cliente
            </Button>
          )}
        </div>

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar clientes..."
          filterControls={
            <>
              {[
                { value: "", label: "Todos", active: "bg-primary text-white shadow-sm shadow-primary/20", inactive: "text-muted-foreground hover:text-foreground hover:bg-muted/60" },
                { value: "VIP", label: "VIP", active: chipStyles.success, inactive: "text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/5" },
                { value: "FREQUENT", label: "Frecuente", active: chipStyles.warning, inactive: "text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/5" },
                { value: "OCCASIONAL", label: "Ocasional", active: chipStyles.neutral, inactive: "text-muted-foreground hover:text-foreground hover:bg-muted/60" },
                { value: "INACTIVE", label: "Inactivo", active: chipStyles.danger, inactive: "text-muted-foreground hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/5" },
              ].map(({ value, label, active, inactive }) => (
                <button
                  key={value}
                  onClick={() => setSegment(value)}
                  className={cn(
                    "h-8 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                    segment === value ? active : inactive
                  )}
                >
                  {label}
                </button>
              ))}
            </>
          }
        />

        {/* Content */}
        {isLoading ? (
          <LoadingState icon={<Users className="w-4 h-4 text-accent/50" />} message="Cargando clientes..." />
        ) : customers.length === 0 ? (
          <EmptyState icon={<Users className="w-6 h-6 text-muted-foreground/30" />} title="No hay clientes" subtitle="Agrega tu primer cliente" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4 stagger-children">
              {customers.map((customer) => {
                const seg = segmentConfig[customer.segment] || segmentConfig.OCCASIONAL;
                return (
                  <div
                    key={customer.id}
                    className={cn(
                      "group rounded-xl border border-border/60 bg-card p-4 transition-all duration-200",
                      "hover:border-primary/25 hover:shadow-md hover:shadow-primary/5",
                      canEdit && "cursor-pointer"
                    )}
                    onClick={canEdit ? () => handleEdit(customer) : undefined}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CustomerAvatar name={customer.name} />
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground truncate leading-tight">{customer.name}</h3>
                          <Badge variant={seg.variant} className="mt-0.5 text-[10px]">{seg.label}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(
                              `/sales?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name)}`,
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                        >
                          <ShoppingBag className="h-3 w-3" /> Ver historial
                        </button>
                        {canEdit && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleEdit(customer); }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label={`Editar ${customer.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(customer.id); }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label={`Eliminar ${customer.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Details */}
                    <div className="space-y-1.5 border-t border-border/40 pt-2.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono shrink-0">{customer.documentType}</span>
                        <span className="text-foreground font-medium">{customer.documentNumber}</span>
                      </div>
                      {customer.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{customer.email}</span>
                        </div>
                      )}
                      {customer.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="w-3 h-3 shrink-0" />
                          <span>{customer.phone}</span>
                        </div>
                      )}
                      {customer.address && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{customer.address}</span>
                        </div>
                      )}
                      {customer.referencia && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Bookmark className="w-3 h-3 shrink-0" />
                          <span className="truncate">Ref: {customer.referencia}</span>
                        </div>
                      )}
                      {customer.placaMoto && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Bike className="w-3 h-3 shrink-0" />
                          <span className="font-mono font-medium text-foreground uppercase">{customer.placaMoto}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {meta && meta.totalPages > 1 && (
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

      <Modal isOpen={canCreate && showModal} onClose={() => setShowModal(false)} title={editingCustomer ? "Editar Cliente" : "Nuevo Cliente"} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Nombre" value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="sm:col-span-2" />
            <BentoSelect label="Tipo de Documento" value={formData.documentType || "CC"} onChange={(value) => setFormData({ ...formData, documentType: value })} options={[{ value: "CC", label: "Cédula de Ciudadanía" }, { value: "NIT", label: "NIT" }, { value: "CE", label: "Cédula de Extranjería" }, { value: "TI", label: "Tarjeta de Identidad" }]} />
            <Input label="Número de Documento" value={formData.documentNumber || ""} onChange={(e) => setFormData({ ...formData, documentNumber: e.target.value })} required />
            <Input label="Email" type="email" value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="sm:col-span-2" />
            <Input label="Teléfono" value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            <Input label="Dirección" value={formData.address || ""} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
            <Input label="Referencia" value={formData.referencia || ""} onChange={(e) => setFormData({ ...formData, referencia: e.target.value })} />
            <Input label="Placa de la moto" value={formData.placaMoto || ""} onChange={(e) => setFormData({ ...formData, placaMoto: e.target.value })} />
            <BentoSelect label="Segmento" value={formData.segment || "OCCASIONAL"} onChange={(value) => setFormData({ ...formData, segment: value as Customer["segment"] })} options={[{ value: "OCCASIONAL", label: "Ocasional" }, { value: "FREQUENT", label: "Frecuente" }, { value: "VIP", label: "VIP" }, { value: "INACTIVE", label: "Inactivo" }]} />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-border/60">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="w-full sm:w-auto">Cancelar</Button>
            <Button type="submit" loading={createCustomer.isPending || updateCustomer.isPending} className="w-full sm:w-auto">{editingCustomer ? "Actualizar" : "Crear"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog isOpen={canEdit && showConfirmModal} onClose={() => setShowConfirmModal(false)} onConfirm={confirmDelete} title="Eliminar Cliente" message="¿Estás seguro? Esta acción no se puede deshacer." confirmText="Eliminar" cancelText="Cancelar" />
    </DashboardLayout>
  );
}
