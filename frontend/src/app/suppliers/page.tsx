"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useSuppliers,
  useCreateSupplier,
  useUpdateSupplier,
  useDeactivateSupplier,
  useReactivateSupplier,
  type SupplierPayload,
} from "@/hooks/useSuppliers";
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
  Phone,
  Mail,
  MapPin,
  Truck,
  Pencil,
  Power,
  PowerOff,
  UserRound,
  CreditCard,
} from "lucide-react";
import type { Supplier } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";

const BANK_STYLES: Record<string, { label: string; badge: string }> = {
  Bancolombia: {
    label: "Bancolombia",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  },
  Davivienda: {
    label: "Davivienda",
    badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25",
  },
  Nequi: {
    label: "Nequi",
    badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25",
  },
  "Bre-B": {
    label: "Bre-B",
    badge: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25",
  },
  "Banco de Bogotá": {
    label: "Banco de Bogotá",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25",
  },
  BBVA: {
    label: "BBVA",
    badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25",
  },
  Nu: {
    label: "Nu",
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25",
  },
  "Lulo Bank": {
    label: "Lulo Bank",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  },
};

function getBankStyle(bankName: string | null | undefined) {
  if (!bankName) return null;
  const match = Object.entries(BANK_STYLES).find(
    ([key]) => key.toLowerCase() === bankName.trim().toLowerCase(),
  );
  if (match) return match[1];
  return {
    label: bankName,
    badge: "bg-muted text-muted-foreground border-border/70",
  };
}

function SupplierAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-11 h-11 rounded-2xl bg-primary-light border border-primary/30 flex items-center justify-center shrink-0">
      <span className="text-xs font-bold text-primary">
        {initials}
      </span>
    </div>
  );
}

export default function SuppliersPage() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");

  const [showModal, setShowModal] = useState(false);
  const [showConfirmDeactivate, setShowConfirmDeactivate] = useState(false);
  const [supplierToDeactivate, setSupplierToDeactivate] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState<SupplierPayload>({});

  const { data, isLoading } = useSuppliers({
    page,
    limit: 20,
    search: search || undefined,
    status: statusFilter,
  });
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deactivateSupplier = useDeactivateSupplier();
  const reactivateSupplier = useReactivateSupplier();

  const suppliers = data?.data ?? [];
  const meta = data?.meta;

  const handleEdit = (supplier: Supplier) => {
    if (!canManage) return;
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      documentNumber: supplier.documentNumber,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      contactName: supplier.contactName,
      bank: supplier.bank,
      accountNumber: supplier.accountNumber,
      accountType: supplier.accountType,
    });
    setShowModal(true);
  };

  const handleCreate = () => {
    if (!canManage) return;
    setEditingSupplier(null);
    setFormData({
      name: "",
      documentNumber: "",
      email: "",
      phone: "",
      address: "",
      contactName: "",
      bank: null,
      accountNumber: "",
      accountType: null,
    });
    setShowModal(true);
  };

  const handleAskDeactivate = (id: string) => {
    if (!canManage) return;
    setSupplierToDeactivate(id);
    setShowConfirmDeactivate(true);
  };

  const confirmDeactivate = async () => {
    if (!supplierToDeactivate) return;
    try {
      await deactivateSupplier.mutateAsync(supplierToDeactivate);
      toast.success("Proveedor desactivado correctamente");
      setShowConfirmDeactivate(false);
      setSupplierToDeactivate(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo desactivar el proveedor"));
    }
  };

  const handleReactivate = async (id: string) => {
    if (!canManage) return;
    try {
      await reactivateSupplier.mutateAsync(id);
      toast.success("Proveedor reactivado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo reactivar el proveedor"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: SupplierPayload = {
      name: formData.name?.trim(),
      documentNumber: formData.documentNumber?.trim(),
      email: formData.email?.trim() || null,
      phone: formData.phone?.trim() || null,
      address: formData.address?.trim() || null,
      contactName: formData.contactName?.trim() || null,
      bank: formData.bank?.trim() || null,
      accountNumber: formData.accountNumber?.trim() || null,
      accountType: formData.accountType || null,
    };
    try {
      if (editingSupplier) {
        await updateSupplier.mutateAsync({ id: editingSupplier.id, data: payload });
        toast.success("Proveedor actualizado correctamente");
      } else {
        await createSupplier.mutateAsync(payload);
        toast.success("Proveedor creado correctamente");
      }
      setShowModal(false);
      setFormData({});
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al guardar el proveedor"));
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 lg:space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-1 h-7 rounded-full bg-accent shrink-0" />
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
                Proveedores
              </h1>
              {meta && (
                <span
                  className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${chipStyles.accent}`}
                >
                  {meta.total} registros
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-4">
              Gestiona tu red de proveedores
            </p>
          </div>
          {canManage && (
            <Button onClick={handleCreate} className="w-full sm:w-auto shrink-0">
              <Plus className="w-4 h-4" /> Nuevo Proveedor
            </Button>
          )}
        </div>

        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Buscar proveedores..."
          filterControls={
            <>
              {[
                { value: "active" as const, label: "Activos" },
                { value: "inactive" as const, label: "Inactivos" },
                { value: "all" as const, label: "Todos" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    setPage(1);
                    setStatusFilter(value);
                  }}
                  className={cn(
                    "h-8 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                    statusFilter === value
                      ? "bg-primary text-white shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  {label}
                </button>
              ))}
            </>
          }
        />

        {isLoading ? (
          <LoadingState icon={<Truck className="w-4 h-4 text-accent/50" />} message="Cargando proveedores..." />
        ) : suppliers.length === 0 ? (
          <EmptyState icon={<Truck className="w-6 h-6 text-muted-foreground/30" />} title="No hay proveedores" subtitle="Agrega tu primer proveedor" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4 stagger-children">
              {suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className={cn(
                    "group rounded-xl border border-border/60 bg-card p-4 transition-all duration-200",
                    "hover:border-primary/25 hover:shadow-md hover:shadow-primary/5",
                    canManage && "cursor-pointer",
                    !supplier.active && "opacity-70",
                  )}
                  onClick={canManage && supplier.active ? () => handleEdit(supplier) : undefined}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SupplierAvatar name={supplier.name} />
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate leading-tight">
                          {supplier.name}
                        </h3>
                        <Badge
                          variant={supplier.active ? "success" : "danger"}
                          className="mt-0.5 text-[10px]"
                        >
                          {supplier.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        {supplier.active ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(supplier);
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                              title="Editar"
                              aria-label={`Editar ${supplier.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAskDeactivate(supplier.id);
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                              title="Desactivar"
                              aria-label={`Desactivar ${supplier.name}`}
                            >
                              <PowerOff className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReactivate(supplier.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[10px] font-semibold text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-300"
                          >
                            <Power className="w-3 h-3" /> Reactivar
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 border-t border-border/40 pt-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono shrink-0">NIT</span>
                      <span className="text-foreground font-medium">
                        {supplier.documentNumber}
                      </span>
                    </div>
                    {supplier.contactName && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <UserRound className="w-3 h-3 shrink-0" />
                        <span className="truncate">{supplier.contactName}</span>
                      </div>
                    )}
                    {supplier.email && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="w-3 h-3 shrink-0" />
                        <span className="truncate">{supplier.email}</span>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span>{supplier.phone}</span>
                      </div>
                    )}
                    {supplier.address && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{supplier.address}</span>
                      </div>
                    )}
                    {(supplier.bank || supplier.accountNumber || supplier.accountType) && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                        <CreditCard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {supplier.bank && (
                          <span
                            className={cn(
                              "inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md border",
                              getBankStyle(supplier.bank)?.badge,
                            )}
                          >
                            {supplier.bank}
                          </span>
                        )}
                        <span className="text-muted-foreground font-mono text-[11px] truncate">
                          {supplier.accountType === "SAVINGS"
                            ? "Ahorros"
                            : supplier.accountType === "CHECKING"
                            ? "Corriente"
                            : "Cuenta"}
                          {supplier.accountNumber ? `: ${supplier.accountNumber}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {meta && meta.totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                itemLabel="proveedor"
              />
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={canManage && showModal}
        onClose={() => setShowModal(false)}
        title={editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Nombre / Razón social"
              value={formData.name || ""}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="sm:col-span-2"
            />
            <Input
              label="NIT / Documento"
              value={formData.documentNumber || ""}
              onChange={(e) =>
                setFormData({ ...formData, documentNumber: e.target.value })
              }
              required
            />
            <Input
              label="Persona de contacto"
              value={formData.contactName || ""}
              onChange={(e) =>
                setFormData({ ...formData, contactName: e.target.value })
              }
            />
            <Input
              label="Email"
              type="email"
              value={formData.email || ""}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
            <Input
              label="Teléfono"
              value={formData.phone || ""}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
            <Input
              label="Dirección"
              value={formData.address || ""}
              onChange={(e) =>
                setFormData({ ...formData, address: e.target.value })
              }
              className="sm:col-span-2"
            />
            <BentoSelect
              label="Banco / Entidad"
              value={formData.bank || ""}
              onChange={(value) =>
                setFormData({
                  ...formData,
                  bank: value || null,
                })
              }
              options={[
                { value: "", label: "Seleccionar..." },
                { value: "Bancolombia", label: "Bancolombia" },
                { value: "Davivienda", label: "Davivienda" },
                { value: "Nequi", label: "Nequi" },
                { value: "Bre-B", label: "Bre-B (Llave / Transfiya)" },
                { value: "Banco de Bogotá", label: "Banco de Bogotá" },
                { value: "BBVA", label: "BBVA" },
                { value: "Nu", label: "Nu Colombia" },
                { value: "Lulo Bank", label: "Lulo Bank" },
              ]}
            />
            <BentoSelect
              label="Tipo de cuenta"
              value={formData.accountType || ""}
              onChange={(value) =>
                setFormData({
                  ...formData,
                  accountType: (value || null) as Supplier["accountType"],
                })
              }
              options={[
                { value: "", label: "Seleccionar..." },
                { value: "SAVINGS", label: "Ahorros" },
                { value: "CHECKING", label: "Corriente" },
              ]}
            />
            <Input
              label="Número de cuenta o Llave"
              value={formData.accountNumber || ""}
              onChange={(e) =>
                setFormData({ ...formData, accountNumber: e.target.value })
              }
              className="sm:col-span-2"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-border/60">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowModal(false)}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createSupplier.isPending || updateSupplier.isPending}
              className="w-full sm:w-auto"
            >
              {editingSupplier ? "Actualizar" : "Crear"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={canManage && showConfirmDeactivate}
        onClose={() => setShowConfirmDeactivate(false)}
        onConfirm={confirmDeactivate}
        title="Desactivar Proveedor"
        message="El proveedor quedará inactivo y no podrá usarse en nuevas órdenes de compra. Podrás reactivarlo cuando quieras."
        confirmText="Desactivar"
        cancelText="Cancelar"
      />
    </DashboardLayout>
  );
}
