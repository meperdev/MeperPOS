"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  COLLECTION_CONTENT_ENTER_CLASSES,
  COLLECTION_GRID_CLASSES,
  COLLECTION_PENDING_CLASSES,
  COLLECTION_PENDING_OPACITY_CLASS,
} from "@/components/ui/collectionGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { CategoryProductsModal } from "@/components/categories/CategoryProductsModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { CollectionSkeleton } from "@/components/ui/CollectionSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  FilterBar,
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
  Package,
  Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { useEffectiveViewMode } from "@/hooks/useEffectiveViewMode";
import { useDeferredLoading } from "@/hooks/useDeferredLoading";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import {
  COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
  COLLECTION_CARD_MIN_WIDTH,
  COLLECTION_GRID_GAP,
  MAX_COLLECTION_PAGE_SIZE,
  MIN_VISIBLE_ROWS,
  remapPageForPageSize,
} from "@/lib/collection-grid";
import type { Category } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";

/** Category identity tones: brand hues only, cycled by position. */
const CATEGORY_ICON_TONES = [
  "border-primary/30 bg-primary/10 text-primary-text",
  "border-accent/30 bg-accent/10 text-accent",
  "border-success/30 bg-success/10 text-success-text",
  "border-warning/30 bg-warning/10 text-warning-text",
  "border-info/30 bg-info/10 text-info-text",
  "border-danger/30 bg-danger/10 text-danger-text",
] as const;

/** Table view: a dense list keeps the page it always had. */
const TABLE_PAGE_SIZE = 10;

export default function CategoriesPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useEffectiveViewMode("categories");

  // Card view fills the viewport: the grid reports how many cards fit, and the
  // table keeps the fixed page it always had.
  const {
    pageSize: gridPageSize,
    containerRef: gridRef,
    footerRef,
    tableRef,
  } = useResponsivePageSize({
    minCardWidth: COLLECTION_CARD_MIN_WIDTH,
    gap: COLLECTION_GRID_GAP,
    rowHeight: COLLECTION_CARD_FALLBACK_ROW_HEIGHT,
    minRows: MIN_VISIBLE_ROWS,
    min: TABLE_PAGE_SIZE,
    max: MAX_COLLECTION_PAGE_SIZE,
    enabled: viewMode === "grid",
  });
  const pageSize = gridPageSize;

  // Re-anchor on the item the user was already looking at when a resize changes
  // the page size, instead of leaving them on a page that now starts elsewhere.
  const previousPageSize = useRef(pageSize);
  useEffect(() => {
    const previous = previousPageSize.current;
    if (previous === pageSize) return;
    previousPageSize.current = pageSize;
    const nextPage = remapPageForPageSize({ page, previousSize: previous, nextSize: pageSize });
    if (nextPage !== page) setPage(nextPage);
  }, [pageSize, page]);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [productsCategory, setProductsCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState<CategoryPayload>({});
  const [defaultTaxRateInput, setDefaultTaxRateInput] = useState("");

  const {
    data,
    isLoading,
    isFetching,
    isError: categoriesFailed,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories({
    page,
    limit: pageSize,
    search: search || undefined,
  });
  // Only the first load paints a skeleton, and only after a short grace period.
  const showSkeleton = useDeferredLoading(isLoading);
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
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
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
              <Plus className="w-4 h-4" /> Nueva categoría
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
        {categoriesFailed && !data ? (
          <ErrorState
            message={getApiErrorMessage(categoriesError, "No se pudieron cargar las categorías.")}
            retryLabel="Reintentar"
            onRetry={() => void refetchCategories()}
          />
        ) : showSkeleton ? (
          <CollectionSkeleton
            viewMode={viewMode}
            columns={5}
            rows={6}
            label="Cargando categorías..."
          />
        ) : isLoading ? null : categories.length === 0 ? (
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
              <div
                ref={gridRef}
                aria-busy={isFetching}
                className={cn(
                  COLLECTION_GRID_CLASSES,
                  "flex-1 content-start",
                  COLLECTION_CONTENT_ENTER_CLASSES,
                  COLLECTION_PENDING_CLASSES,
                  isFetching && COLLECTION_PENDING_OPACITY_CLASS,
                )}
              >
                {categories.map((category, i) => {
                  const count = category.productCount ?? 0;
                  return (
                    <div
                      key={category.id}
                      className="group relative flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-4 shadow-2xs cursor-pointer transition-colors hover:border-border active:bg-muted/60"
                    >
                      {/* The card's edit target: a real button stretched over the card; controls below sit above it. */}
                      <button
                        type="button"
                        aria-label={`Editar ${category.name}`}
                        onClick={() => handleEdit(category)}
                        className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] transition-colors duration-150 active:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      />
                      <div>
                        {/* Card Header */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", CATEGORY_ICON_TONES[i % CATEGORY_ICON_TONES.length])}>
                              <FolderTree className="w-4 h-4" />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
                              {category.name}
                            </h3>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(category.id);
                              }}
                              className="relative z-10 flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-danger-text hover:border-danger/30 hover:bg-danger/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                              aria-label={`Eliminar ${category.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Description */}
                        {category.description ? (
                          <p className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed min-h-[2rem]">
                            {category.description}
                          </p>
                        ) : (
                          <p className="text-[13px] text-muted-foreground/45 min-h-[2rem]">
                            Sin descripción
                          </p>
                        )}
                      </div>

                      {/* Footer: Product count & Tax rate */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-border/60">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProductsCategory(category);
                          }}
                          className="relative z-10 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-muted/35 px-2.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                          aria-label={`Ver productos de ${category.name}`}
                        >
                          <Package className="w-3.5 h-3.5 shrink-0 opacity-75" />
                          <span>
                            <span
                              className={cn(
                                " font-semibold tabular-nums",
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
                          <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap px-2 py-0.5 rounded-md text-xs font-medium bg-muted/50 text-foreground border border-border/70 tabular-nums">
                            <Percent className="w-2.5 h-2.5" />
                            {category.defaultTaxRate}%
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center whitespace-nowrap px-2 py-0.5 rounded-md text-xs text-muted-foreground bg-muted/40 border border-border/60">
                            Sin impuesto
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className={cn(
                  "w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden flex-1",
                  COLLECTION_CONTENT_ENTER_CLASSES,
                  COLLECTION_PENDING_CLASSES,
                  isFetching && COLLECTION_PENDING_OPACITY_CLASS,
                )}
              >
                <div ref={tableRef} className="overflow-x-auto">
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
                            className="cursor-pointer active:bg-muted/40"
                            onClick={() => handleEdit(category)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", CATEGORY_ICON_TONES[i % CATEGORY_ICON_TONES.length])}>
                                  <FolderTree className="w-3.5 h-3.5" />
                                </div>
                                <button
                                  type="button"
                                  aria-label={`Editar ${category.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(category);
                                  }}
                                  className="text-left text-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
                                >
                                  {category.name}
                                </button>
                              </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          {category.description ? (
                            <span className="text-[13px] text-muted-foreground line-clamp-1">
                              {category.description}
                            </span>
                          ) : (
                            <span className="text-[13px] text-muted-foreground/45">
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
                              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                              aria-label={`Ver productos de ${category.name}`}
                            >
                              <Package className="w-3.5 h-3.5 shrink-0 opacity-75" />
                              <span className="font-semibold text-foreground tabular-nums">
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
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-medium bg-muted/50 text-foreground border border-border/70 tabular-nums">
                              <Percent className="w-2.5 h-2.5" />
                              {category.defaultTaxRate}%
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs text-muted-foreground bg-muted/40 border border-border/60">
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
                              onClick={() => handleDelete(category.id)}
                              className="flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:text-danger-text hover:border-danger/30 hover:bg-danger/10 transition-colors"
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
              // `contents` keeps the pager a direct flex child (sticky bottom and
              // mt-auto still work) while the sizing hook measures it.
              <div ref={footerRef} className="contents">
                <Pagination
                  currentPage={page}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  totalItems={meta.total}
                  pageSize={pageSize}
                  itemLabel="categoría"
                />
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCategory ? "Editar categoría" : "Nueva categoría"}
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
              <span className="text-[13px] font-medium text-muted-foreground mr-1">
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
                      "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      isSelected
                        ? "border-primary/40 bg-primary/15 text-primary-text"
                        : "border-border/70 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[13px] text-muted-foreground">
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
        title="Eliminar categoría"
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
