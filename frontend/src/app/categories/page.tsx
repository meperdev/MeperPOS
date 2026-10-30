"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/hooks/useCategories";
import type {
  CategoryPayload,
  CreateCategoryPayload,
  UpdateCategoryPayload,
} from "@/hooks/useCategories";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { CategoryProductsModal } from "@/components/categories/CategoryProductsModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  FilterBar,
  FilterClearButton,
} from "@/components/ui/FilterBar";
import {
  Table,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/Table";
import {
  Plus,
  Trash2,
  FolderTree,
  Pencil,
  Package,
  Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import type { Category } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";

/** Category identity tones: brand hues only, cycled by position. */
const CATEGORY_ICON_TONES = [
  "border-primary/30 bg-primary/10 text-primary",
  "border-accent/30 bg-accent/10 text-accent",
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
] as const;

export default function CategoriesPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = usePersistedViewMode("categories");
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [productsCategory, setProductsCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState<CategoryPayload>({});
  const [defaultTaxRateInput, setDefaultTaxRateInput] = useState("");

  const { data, isLoading } = useCategories({
    page,
    limit: viewMode === "grid" ? 12 : 10,
    search: search || undefined,
  });
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const categories = data?.data || [];
  const meta = data?.meta;

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description ?? "",
      active: category.active,
    });
    setDefaultTaxRateInput(
      category.defaultTaxRate != null ? String(category.defaultTaxRate) : "",
    );
    setShowModal(true);
  };
  const handleCreate = () => {
    setEditingCategory(null);
    setFormData({ name: "", description: "" });
    setDefaultTaxRateInput("");
    setShowModal(true);
  };
  const handleDelete = (id: string) => {
    setCategoryToDelete(id);
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    if (categoryToDelete) {
      try {
        await deleteCategory.mutateAsync(categoryToDelete);
        toast.success("Categoría eliminada correctamente");
        setShowConfirmModal(false);
        setCategoryToDelete(null);
      } catch (error) {
        toast.error(
          getApiErrorMessage(
            error,
            "No se pudo eliminar la categoría. Verifica si tiene productos asociados.",
          ),
        );
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const hasTaxInput = defaultTaxRateInput.trim() !== "";
    const parsedTaxRate = hasTaxInput ? Number(defaultTaxRateInput) : undefined;
    if (hasTaxInput && Number.isNaN(parsedTaxRate)) {
      toast.error("Ingresa una tasa de impuesto válida");
      return;
    }

    try {
      if (editingCategory) {
        const payload: UpdateCategoryPayload = {
          ...formData,
          ...(hasTaxInput
            ? { defaultTaxRate: parsedTaxRate }
            : { defaultTaxRate: null }),
        };
        await updateCategory.mutateAsync({
          id: editingCategory.id,
          data: payload,
        });
        toast.success("Categoría actualizada correctamente");
      } else {
        const payload: CreateCategoryPayload = {
          name: formData.name,
          description: formData.description,
          active: formData.active,
          ...(hasTaxInput ? { defaultTaxRate: parsedTaxRate } : {}),
        };
        await createCategory.mutateAsync(payload);
        toast.success("Categoría creada correctamente");
      }
      setShowModal(false);
      setFormData({});
      setDefaultTaxRateInput("");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al guardar la categoría"));
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-5">
        {/* Page Header */}
<PageHeader
          title="Categorías"
          subtitle="Organiza tu catálogo de productos e impuestos por defecto"
          count={
            meta
              ? `${meta.total} ${meta.total === 1 ? "categoría" : "categorías"}`
              : undefined
          }
          actions={
            <Button onClick={handleCreate} className="w-full sm:w-auto">
              <Plus className="w-4 h-4" /> Nueva Categoría
            </Button>
          }
        />

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchPlaceholder="Buscar por nombre o descripción..."
          filterControls={
            <>
              {search && (
                <FilterClearButton
                  onClick={() => {
                    setSearch("");
                    setPage(1);
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
            icon={<FolderTree className="w-4 h-4 text-muted-foreground" />}
            message="Cargando categorías..."
          />
        ) : categories.length === 0 ? (
          <EmptyState
            icon={<FolderTree className="w-5 h-5 text-muted-foreground" />}
            title={
              search
                ? "Sin resultados para tu búsqueda"
                : "No hay categorías registradas"
            }
            subtitle={
              search
                ? "Prueba con otro término o limpia el filtro de búsqueda."
                : "Crea la primera categoría para estructurar tu catálogo."
            }
          />
        ) : (
          <>
            {viewMode === "grid" ? (
              <div className="grid flex-1 content-start grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 lg:gap-4 stagger-children">
                {categories.map((category, i) => {
                  const count = category.productCount ?? 0;
                  return (
                    <div
                      key={category.id}
                      className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-2xs cursor-pointer transition-colors hover:border-border"
                      onClick={() => handleEdit(category)}
                    >
                      <div>
                        {/* Card Header */}
                        <div className="flex items-start justify-between gap-2.5 mb-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", CATEGORY_ICON_TONES[i % CATEGORY_ICON_TONES.length])}>
                              <FolderTree className="w-4 h-4" />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
                              {category.name}
                            </h3>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(category);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60 transition-colors"
                              aria-label={`Editar ${category.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(category.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 hover:bg-rose-500/10 transition-colors"
                              aria-label={`Eliminar ${category.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Description */}
                        {category.description ? (
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed min-h-[2rem]">
                            {category.description}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground/45 min-h-[2rem]">
                            Sin descripción
                          </p>
                        )}
                      </div>

                      {/* Footer: Product count & Tax rate */}
                      <div className="flex items-center justify-between gap-2 mt-3.5 pt-3 border-t border-border/60">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProductsCategory(category);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-2.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground"
                          aria-label={`Ver productos de ${category.name}`}
                        >
                          <Package className="w-3.5 h-3.5 shrink-0 opacity-75" />
                          <span>
                            <span
                              className={cn(
                                "font-mono font-semibold tabular-nums",
                                count > 0
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {count}
                            </span>{" "}
                            {count === 1 ? "producto" : "productos"}
                          </span>
                        </button>

                        {category.defaultTaxRate != null ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-mono text-[11px] font-medium bg-muted/50 text-foreground border border-border/70 tabular-nums">
                            <Percent className="w-2.5 h-2.5" />
                            {category.defaultTaxRate}%
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] text-muted-foreground bg-muted/40 border border-border/60">
                            Sin impuesto
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden animate-fade-in flex-1">
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableCell as="th">Categoría</TableCell>
                        <TableCell as="th">Descripción</TableCell>
                        <TableCell as="th" className="text-right">
                          Productos
                        </TableCell>
                        <TableCell as="th" className="text-right">
                          Impuesto por defecto
                        </TableCell>
                        <TableCell as="th" className="text-right">
                          Acciones
                        </TableCell>
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {categories.map((category, i) => {
                        const count = category.productCount ?? 0;
                        return (
                          <TableRow
                            key={category.id}
                            className="cursor-pointer"
                            onClick={() => handleEdit(category)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", CATEGORY_ICON_TONES[i % CATEGORY_ICON_TONES.length])}>
                                  <FolderTree className="w-3.5 h-3.5" />
                                </div>
                                <span className="text-xs font-semibold text-foreground">
                                  {category.name}
                                </span>
                              </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          {category.description ? (
                            <span className="text-xs text-muted-foreground line-clamp-1">
                              {category.description}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/45">
                              Sin descripción
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="inline-flex justify-end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setProductsCategory(category)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground"
                              aria-label={`Ver productos de ${category.name}`}
                            >
                              <Package className="w-3.5 h-3.5 shrink-0 opacity-75" />
                              <span className="font-mono font-semibold text-foreground tabular-nums">
                                {count}
                              </span>
                              <span>
                                {count === 1 ? "producto" : "productos"}
                              </span>
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {category.defaultTaxRate != null ? (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-mono text-[11px] font-medium bg-muted/50 text-foreground border border-border/70 tabular-nums">
                              <Percent className="w-2.5 h-2.5" />
                              {category.defaultTaxRate}%
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] text-muted-foreground bg-muted/40 border border-border/60">
                              Sin impuesto
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div
                            className="inline-flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleEdit(category)}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60 transition-colors"
                              aria-label={`Editar ${category.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(category.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 hover:bg-rose-500/10 transition-colors"
                              aria-label={`Eliminar ${category.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
                itemLabel="categoría"
              />
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCategory ? "Editar Categoría" : "Nueva Categoría"}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre"
            placeholder="Ej: Bebidas, Lácteos, Aseo..."
            value={formData.name || ""}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <Input
            label="Descripción"
            placeholder="Descripción breve para identificar los productos de esta categoría..."
            value={formData.description || ""}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            textarea
            rows={3}
          />
          <div className="space-y-2">
            <Input
              label="Impuesto por defecto (%)"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Ej: 19"
              value={defaultTaxRateInput}
              onChange={(e) => setDefaultTaxRateInput(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground mr-1">
                Tasas rápidas:
              </span>
              {[
                { label: "Sin tasa", value: "" },
                { label: "0%", value: "0" },
                { label: "5%", value: "5" },
                { label: "8%", value: "8" },
                { label: "19%", value: "19" },
              ].map((preset) => {
                const isSelected = defaultTaxRateInput.trim() === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setDefaultTaxRateInput(preset.value)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition-colors tabular-nums",
                      isSelected
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border/70 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Se aplicará a los productos de esta categoría que no definan una
              tasa propia. Si queda en &ldquo;Sin tasa&rdquo;, el producto usará
              el impuesto general del negocio.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-border/60">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                setDefaultTaxRateInput("");
              }}
              className="w-full sm:w-auto sm:min-w-[132px] px-6"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createCategory.isPending || updateCategory.isPending}
              className="w-full sm:w-auto sm:min-w-[132px] px-6"
            >
              {editingCategory ? "Actualizar" : "Crear"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={confirmDelete}
        title="Eliminar Categoría"
        message="¿Estás seguro? Esta acción no se puede deshacer."
        confirmText="Eliminar"
        cancelText="Cancelar"
      />

      <CategoryProductsModal
        category={productsCategory}
        onClose={() => setProductsCategory(null)}
      />
    </DashboardLayout>
  );
}
