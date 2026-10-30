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
import {
  FilterBar,
  FilterClearButton,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import {
  Table,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/Table";
import { cn } from "@/lib/utils";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import {
  Plus,
  Phone,
  Mail,
  MapPin,
  Truck,
  Power,
  PowerOff,
  UserRound,
  CreditCard,
  Copy,
  Check,
} from "lucide-react";
import type { Supplier } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";

function SupplierAvatar({ name }: { name: string }) {
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

/** Bank chips keep each entity's brand hue; unknown banks fall back to neutral. */
const BANK_CHIP_STYLES: Record<string, string> = {
  Bancolombia: "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  Davivienda: "border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300",
  Nequi: "border-purple-500/35 bg-purple-500/12 text-purple-700 dark:text-purple-300",
  "Bre-B": "border-teal-500/35 bg-teal-500/12 text-teal-700 dark:text-teal-300",
  "Banco de Bogotá": "border-blue-500/35 bg-blue-500/12 text-blue-700 dark:text-blue-300",
  BBVA: "border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300",
  Nu: "border-violet-500/35 bg-violet-500/12 text-violet-700 dark:text-violet-300",
  "Lulo Bank": "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
};

function getBankChipStyle(bankName: string | null | undefined) {
  if (!bankName) return "border-border/70 bg-muted/50 text-foreground";
  const match = Object.entries(BANK_CHIP_STYLES).find(
    ([key]) => key.toLowerCase() === bankName.trim().toLowerCase(),
  );
  return match?.[1] ?? "border-border/70 bg-muted/50 text-foreground";
}

export default function SuppliersPage() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [viewMode, setViewMode] = usePersistedViewMode("suppliers");

  const [showModal, setShowModal] = useState(false);
  const [showConfirmDeactivate, setShowConfirmDeactivate] = useState(false);
  const [supplierToDeactivate, setSupplierToDeactivate] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState<SupplierPayload>({});
  const [copiedSupplierId, setCopiedSupplierId] = useState<string | null>(null);

  const handleCopyAccount = async (e: React.MouseEvent, supplier: Supplier) => {
    e.stopPropagation();
    if (!supplier.accountNumber) return;
    try {
      await navigator.clipboard.writeText(supplier.accountNumber);
      setCopiedSupplierId(supplier.id);
      toast.success(`Cuenta ${supplier.accountNumber} copiada al portapapeles`);
      setTimeout(() => {
        setCopiedSupplierId((prev) => (prev === supplier.id ? null : prev));
      }, 1800);
    } catch {
      toast.error("No se pudo copiar el número de cuenta");
    }
  };

  const { data, isLoading } = useSuppliers({
    page,
    limit: viewMode === "grid" ? 12 : 10,
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

  const hasActiveFilters = search !== "" || statusFilter !== "active";

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-5">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                Proveedores
              </h1>
              {meta && (
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-muted/50 text-muted-foreground border border-border/70 tabular-nums">
                  {meta.total} {meta.total === 1 ? "proveedor" : "proveedores"}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gestiona tu red de proveedores, contactos comerciales y cuentas de
              pago
            </p>
          </div>
          {canManage && (
            <Button onClick={handleCreate} className="w-full sm:w-auto shrink-0">
              <Plus className="w-4 h-4" /> Nuevo Proveedor
            </Button>
          )}
        </div>

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          searchPlaceholder="Buscar por razón social, NIT, contacto o correo..."
          filterControls={
            <>
              <FilterGroup label="Estado">
                {[
                  { value: "active" as const, label: "Activos" },
                  { value: "inactive" as const, label: "Inactivos" },
                  { value: "all" as const, label: "Todos" },
                ].map(({ value, label }) => (
                  <FilterOptionButton
                    key={value}
                    active={statusFilter === value}
                    onClick={() => {
                      setPage(1);
                      setStatusFilter(value);
                    }}
                  >
                    {label}
                  </FilterOptionButton>
                ))}
              </FilterGroup>

              {hasActiveFilters && (
                <FilterClearButton
                  onClick={() => {
                    setPage(1);
                    setSearch("");
                    setStatusFilter("active");
                  }}
                />
              )}

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
          <LoadingState
            icon={<Truck className="w-4 h-4 text-muted-foreground" />}
            message="Cargando proveedores..."
          />
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={<Truck className="w-5 h-5 text-muted-foreground" />}
            title={
              hasActiveFilters
                ? "Sin resultados para tu búsqueda"
                : "No hay proveedores registrados"
            }
            subtitle={
              hasActiveFilters
                ? "Prueba con otro término o limpia los filtros activos."
                : "Agrega tu primer proveedor para registrar órdenes de compra."
            }
          />
        ) : (
          <>
            {viewMode === "grid" ? (
              <div className="grid flex-1 content-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 lg:gap-4 stagger-children">
                {suppliers.map((supplier) => {
                  const hasContactInfo = Boolean(
                    supplier.contactName ||
                      supplier.phone ||
                      supplier.email ||
                      supplier.address,
                  );
                  const hasBankInfo = Boolean(
                    supplier.bank ||
                      supplier.accountNumber ||
                      supplier.accountType,
                  );

                  return (
                    <div
                      key={supplier.id}
                      className={cn(
                        "group flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border",
                        canManage && "cursor-pointer",
                        !supplier.active && "opacity-70",
                      )}
                      onClick={
                        canManage ? () => handleEdit(supplier) : undefined
                      }
                    >
                      <div>
                        {/* Card Header: Avatar + Name + NIT + Status */}
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <SupplierAvatar name={supplier.name} />
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-foreground truncate leading-snug">
                                {supplier.name}
                              </h3>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground font-mono tabular-nums">
                                <span>NIT</span>
                                <span>·</span>
                                <span className="text-foreground/90 font-medium truncate">
                                  {supplier.documentNumber}
                                </span>
                              </div>
                            </div>
                          </div>
                          <Badge
                            variant={supplier.active ? "success" : "danger"}
                            dot
                            className="shrink-0"
                          >
                            {supplier.active ? "Activo" : "Inactivo"}
                          </Badge>
                        </div>

                        {/* Contact Details */}
                        <div className="mt-3 border-t border-border/50 pt-2.5 min-h-[4.25rem]">
                          {!hasContactInfo ? (
                            <p className="text-xs text-muted-foreground/50">
                              Sin datos de contacto adicionales
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {(supplier.contactName || supplier.phone) && (
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                  {supplier.contactName ? (
                                    <span className="inline-flex items-center gap-1.5 min-w-0">
                                      <UserRound className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                                      <span className="text-foreground/90 font-medium truncate">
                                        {supplier.contactName}
                                      </span>
                                    </span>
                                  ) : (
                                    <span />
                                  )}
                                  {supplier.phone && (
                                    <span className="inline-flex items-center gap-1 font-mono text-foreground/90 tabular-nums shrink-0">
                                      <Phone className="w-3 h-3 shrink-0 text-muted-foreground/70" />
                                      {supplier.phone}
                                    </span>
                                  )}
                                </div>
                              )}
                              {supplier.email && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Mail className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                                  <span className="truncate">
                                    {supplier.email}
                                  </span>
                                </div>
                              )}
                              {supplier.address && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                                  <span className="truncate">
                                    {supplier.address}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer: Bank Account & Actions */}
                      <div className="mt-3 border-t border-border/50 pt-2.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                          <CreditCard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {hasBankInfo ? (
                            <>
                              {supplier.bank && (
                                <span
                                  className={cn(
                                    "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium",
                                    getBankChipStyle(supplier.bank),
                                  )}
                                >
                                  {supplier.bank}
                                </span>
                              )}
                              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                                {supplier.accountType === "SAVINGS"
                                  ? "Ahorros"
                                  : supplier.accountType === "CHECKING"
                                    ? "Corriente"
                                    : "Cuenta"}
                                {supplier.accountNumber
                                  ? `: ${supplier.accountNumber}`
                                  : ""}
                              </span>
                              {supplier.accountNumber && (
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleCopyAccount(e, supplier)
                                  }
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                                  title="Copiar número de cuenta"
                                  aria-label={`Copiar cuenta de ${supplier.name}`}
                                >
                                  {copiedSupplierId === supplier.id ? (
                                    <Check className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">
                              Sin cuenta bancaria
                            </span>
                          )}
                        </div>

                        {canManage && (
                          <div className="flex shrink-0 items-center gap-1">
                            {supplier.active ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAskDeactivate(supplier.id);
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 hover:bg-rose-500/10 transition-colors"
                                title="Desactivar"
                                aria-label={`Desactivar ${supplier.name}`}
                              >
                                <PowerOff className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReactivate(supplier.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
                              >
                                <Power className="w-3 h-3" /> Reactivar
                              </button>
                            )}
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
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableCell as="th">Proveedor</TableCell>
                        <TableCell as="th">Contacto</TableCell>
                        <TableCell as="th">Ubicación</TableCell>
                        <TableCell as="th">Cuenta bancaria</TableCell>
                        <TableCell as="th">Estado</TableCell>
                        {canManage && (
                          <TableCell as="th" className="text-right">
                            Acciones
                          </TableCell>
                        )}
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {suppliers.map((supplier) => {
                    const hasBankInfo = Boolean(
                      supplier.bank ||
                        supplier.accountNumber ||
                        supplier.accountType,
                    );
                    return (
                      <TableRow
                        key={supplier.id}
                        className={cn(
                          canManage && "cursor-pointer",
                          !supplier.active && "opacity-70",
                        )}
                        onClick={
                          canManage ? () => handleEdit(supplier) : undefined
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <SupplierAvatar name={supplier.name} />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">
                                {supplier.name}
                              </p>
                              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                                NIT · {supplier.documentNumber}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {supplier.contactName ||
                          supplier.phone ||
                          supplier.email ? (
                            <div className="space-y-0.5 text-xs">
                              {supplier.contactName && (
                                <p className="font-medium text-foreground">
                                  {supplier.contactName}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                                {supplier.phone && (
                                  <span className="font-mono tabular-nums">
                                    {supplier.phone}
                                  </span>
                                )}
                                {supplier.email && (
                                  <span className="truncate max-w-[180px]">
                                    {supplier.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/45">
                              Sin contacto
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          {supplier.address ? (
                            <span className="text-xs text-muted-foreground line-clamp-1">
                              {supplier.address}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/45">
                              Sin dirección
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {hasBankInfo ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {supplier.bank && (
                                <span
                                  className={cn(
                                    "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium",
                                    getBankChipStyle(supplier.bank),
                                  )}
                                >
                                  {supplier.bank}
                                </span>
                              )}
                              <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                                {supplier.accountType === "SAVINGS"
                                  ? "Ahorros"
                                  : supplier.accountType === "CHECKING"
                                    ? "Corriente"
                                    : "Cuenta"}
                                {supplier.accountNumber
                                  ? `: ${supplier.accountNumber}`
                                  : ""}
                              </span>
                              {supplier.accountNumber && (
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleCopyAccount(e, supplier)
                                  }
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                                  title="Copiar número de cuenta"
                                  aria-label={`Copiar cuenta de ${supplier.name}`}
                                >
                                  {copiedSupplierId === supplier.id ? (
                                    <Check className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/45">
                              Sin cuenta
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={supplier.active ? "success" : "danger"}
                            dot
                          >
                            {supplier.active ? "Activo" : "Inactivo"}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div
                              className="inline-flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {supplier.active ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAskDeactivate(supplier.id)
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 hover:bg-rose-500/10 transition-colors"
                                  title="Desactivar"
                                  aria-label={`Desactivar ${supplier.name}`}
                                >
                                  <PowerOff className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleReactivate(supplier.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
                                >
                                  <Power className="w-3 h-3" /> Reactivar
                                </button>
                              )}
                            </div>
                          </TableCell>
                        )}
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
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Commercial & Contact Info */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-foreground">
              Datos comerciales y contacto
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Input
                label="Nombre / Razón social"
                placeholder="Ej: Tostadora de Café San Alberto S.A.S."
                value={formData.name || ""}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
                className="sm:col-span-2"
              />
              <Input
                label="NIT / Documento"
                placeholder="Ej: 900.412.889-1"
                value={formData.documentNumber || ""}
                onChange={(e) =>
                  setFormData({ ...formData, documentNumber: e.target.value })
                }
                required
              />
              <Input
                label="Persona de contacto"
                placeholder="Nombre del asesor o ejecutivo comercial"
                value={formData.contactName || ""}
                onChange={(e) =>
                  setFormData({ ...formData, contactName: e.target.value })
                }
              />
              <Input
                label="Email"
                type="email"
                placeholder="pedidos@proveedor.com.co"
                value={formData.email || ""}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
              />
              <Input
                label="Teléfono"
                placeholder="Ej: 310 445 8920"
                value={formData.phone || ""}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
              <Input
                label="Dirección"
                placeholder="Dirección de bodega o sede principal"
                value={formData.address || ""}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                className="sm:col-span-2"
              />
            </div>
          </div>

          {/* Bank Info */}
          <div className="space-y-3 pt-4 border-t border-border/60">
            <h3 className="text-xs font-semibold text-foreground">
              Datos bancarios y pagos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
                placeholder="Ej: 031-884920-14 o @llavebreb"
                value={formData.accountNumber || ""}
                onChange={(e) =>
                  setFormData({ ...formData, accountNumber: e.target.value })
                }
                className="sm:col-span-2"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-border/60">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowModal(false)}
              className="w-full sm:w-auto sm:min-w-[132px] px-6"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createSupplier.isPending || updateSupplier.isPending}
              className="w-full sm:w-auto sm:min-w-[132px] px-6"
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
