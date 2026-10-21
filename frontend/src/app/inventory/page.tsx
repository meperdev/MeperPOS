"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeactivateProduct,
  useDeleteProduct,
  useReactivateProduct,
  useUploadProductImage,
} from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ImageUpload } from "@/components/ui/ImageUpload";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { ProductCard } from "@/components/products/ProductCard";
import {
  Plus,
  AlertTriangle,
  Package,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Product } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn, resolveTaxFields, toFiniteNumber } from "@/lib/utils";
import { isService } from "@/lib/product-type";
import { hasAnyRole } from "@/lib/auth";

function InventoryContent() {
  const searchParams = useSearchParams();
  const urlLowStock = searchParams?.get("filter") === "lowStock";
  const toast = useToast();
  const { user } = useAuth();
  const canManageInventory = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | "all"
  >("active");
  const [lowStockFilter, setLowStockFilter] = useState({
    urlValue: urlLowStock,
    enabled: urlLowStock,
  });
  const urlFilterChanged = lowStockFilter.urlValue !== urlLowStock;
  const showLowStockOnly = urlFilterChanged ? urlLowStock : lowStockFilter.enabled;

  // Adjust only on URL transitions: unrelated renders must preserve manual toggles.
  // Resolve the new query immediately, without fetching a stale page/filter first.
  if (urlFilterChanged) {
    setLowStockFilter({ urlValue: urlLowStock, enabled: urlLowStock });
    setPage(1);
  }
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDeactivate, setProductToDeactivate] = useState<string | null>(
    null,
  );
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [productToReactivate, setProductToReactivate] = useState<string | null>(
    null,
  );
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({});
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  // Mutation flags can lag behind the first await; keep the editor locked synchronously.
  const saveInProgressRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [taxRateInput, setTaxRateInput] = useState("");
  // "Oferta" inputs kept as raw strings (like taxRateInput) so partial typing
  // works; parsed on submit. Empty type = no promotion (explicit null clears).
  const [promotionTypeInput, setPromotionTypeInput] =
    useState<"" | "PERCENTAGE" | "FIXED_PRICE">("");
  const [promotionValueInput, setPromotionValueInput] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Filter setters reset to page 1 so a stale page number is never applied to
  // a new filter combination (sales-page parity).
  const updateSearch = (value: string) => {
    setPage(1);
    setSearch(value);
  };

  const updateStatusFilter = (value: string) => {
    setPage(1);
    setStatusFilter(value as "active" | "inactive" | "all");
  };

  const updateSelectedCategory = (value: string | null) => {
    setPage(1);
    setSelectedCategory(value);
  };

  const toggleLowStockOnly = () => {
    setPage(1);
    setLowStockFilter({ urlValue: urlLowStock, enabled: !showLowStockOnly });
  };

  // Server-side pagination: every request — filtered or not — is bounded to
  // one page of rows. Low stock and alphabetical order are resolved by the
  // backend (findAll lowStock/orderBy) so pages stay coherent.
  const { data, isLoading, isFetching } = useProducts({
    page: urlFilterChanged ? 1 : page,
    limit: 10,
    search: search || undefined,
    categoryId: selectedCategory || undefined,
    status: statusFilter,
    lowStock: showLowStockOnly || undefined,
    orderBy: "name",
  });
  const { data: categoriesData } = useCategories();

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deactivateProduct = useDeactivateProduct();
  const deleteProduct = useDeleteProduct();
  const reactivateProduct = useReactivateProduct();
  const uploadProductImage = useUploadProductImage();

  const products = data?.data || [];
  const meta = data?.meta;
  const categories = categoriesData?.data ?? [];

  useEffect(() => {
    if (meta && meta.totalPages > 0 && page > meta.totalPages) {
      setPage(1);
    }
  }, [meta, page]);

  // The low-stock decision is the server's (findAll also filters in the database), so the
  // badge count reads the server-computed flag instead of re-deriving the rule here.
  const lowStockProducts = products
    .filter((p) => p.isLowStock === true)
    .toSorted((a, b) =>
      a.name.localeCompare(b.name, "es-CO", {
        sensitivity: "base",
        numeric: true,
      }),
    );
  const displayProducts = (
    showLowStockOnly ? lowStockProducts : products
  ).toSorted((a, b) =>
    a.name.localeCompare(b.name, "es-CO", {
      sensitivity: "base",
      numeric: true,
    }),
  );

  const closeEditor = () => {
    if (saveInProgressRef.current) return;
    setShowModal(false);
    setEditingProduct(null);
    setFormData({});
    setPendingImageFile(null);
    setTaxRateInput("");
    setPromotionTypeInput("");
    setPromotionValueInput("");
  };

  const handleEdit = (product: Product) => {
    if (!canManageInventory || saveInProgressRef.current) return;
    // The backend serializes Prisma `Decimal` columns as JSON strings, so every
    // Decimal-backed field arrives as "15000.00". Normalize them HERE, the single
    // seed point, so the form never holds a string: a string price both fails the
    // `Number.isFinite` submit guard (blocking every save) and inflates the
    // digit-only currency formatter 100x ("15.000" -> "1.500.000").
    const costPrice = toFiniteNumber(product.costPrice);
    const salePrice = toFiniteNumber(product.salePrice);
    const taxRate = toFiniteNumber(product.taxRate);
    const promotionValue =
      product.promotionValue != null
        ? toFiniteNumber(product.promotionValue)
        : null;
    setPendingImageFile(null);
    setEditingProduct(product);
    setFormData({ ...product, costPrice, salePrice, taxRate, promotionValue });
    setTaxRateInput(taxRate > 0 ? String(taxRate) : "");
    setPromotionTypeInput(product.promotionType ?? "");
    setPromotionValueInput(promotionValue != null ? String(promotionValue) : "");
    setShowModal(true);
  };

  const handleCreate = () => {
    if (!canManageInventory || saveInProgressRef.current) return;
    setPendingImageFile(null);
    setEditingProduct(null);
    setFormData({
      name: "",
      sku: "",
      barcode: "",
      description: "",
      costPrice: 0,
      salePrice: 0,
      stock: 0,
      minStock: 5,
      tracksStock: true,
      categoryId: "",
    });
    setTaxRateInput("");
    setPromotionTypeInput("");
    setPromotionValueInput("");
    setShowModal(true);
  };

  const handleDeactivate = (id: string) => {
    if (!canManageInventory) return;
    setProductToDeactivate(id);
    setShowDeactivateModal(true);
  };

  const confirmDeactivate = async () => {
    if (productToDeactivate) {
      try {
        await deactivateProduct.mutateAsync(productToDeactivate);
        toast.success("Producto desactivado correctamente");
        if (editingProduct?.id === productToDeactivate) closeEditor();
        setShowDeactivateModal(false);
        setProductToDeactivate(null);
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "No se pudo desactivar el producto"),
        );
      }
    }
  };

  const handleDelete = (id: string) => {
    if (!canManageInventory) return;
    setProductToDelete(id);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (productToDelete) {
      try {
        await deleteProduct.mutateAsync(productToDelete);
        toast.success("Producto eliminado definitivamente");
        if (editingProduct?.id === productToDelete) closeEditor();
        setShowDeleteModal(false);
        setProductToDelete(null);
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "No se pudo eliminar el producto"),
        );
      }
    }
  };

  const handleReactivate = (id: string) => {
    if (!canManageInventory) return;
    setProductToReactivate(id);
    setShowReactivateModal(true);
  };

  const confirmReactivate = async () => {
    if (productToReactivate) {
      try {
        await reactivateProduct.mutateAsync(productToReactivate);
        toast.success("Producto reactivado correctamente");
        if (editingProduct?.id === productToReactivate) closeEditor();
        setShowReactivateModal(false);
        setProductToReactivate(null);
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "No se pudo reactivar el producto"),
        );
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveInProgressRef.current) return;
    const normalizedCategoryId =
      formData.categoryId?.toString().trim() || undefined;
    if (!formData.name?.trim() || !formData.sku?.trim() || !normalizedCategoryId) {
      toast.error("Completa nombre, SKU y categoría antes de guardar");
      return;
    }
    const hasExplicitTaxRate = taxRateInput.trim() !== "";
    const parsedTaxRate = hasExplicitTaxRate ? Number(taxRateInput) : undefined;
    if (hasExplicitTaxRate && (Number.isNaN(parsedTaxRate) || parsedTaxRate! < 0)) {
      toast.error("Ingresa una tasa de impuesto válida");
      return;
    }
    if (
      !Number.isFinite(formData.costPrice ?? 0) || (formData.costPrice ?? 0) < 0 ||
      !Number.isFinite(formData.salePrice ?? 0) || (formData.salePrice ?? 0) < 0 ||
      (!isService(formData) && formData.tracksStock !== false &&
        (!Number.isFinite(formData.stock ?? 0) || (formData.stock ?? 0) < 0 ||
         !Number.isFinite(formData.minStock ?? 0) || (formData.minStock ?? 0) < 0))
    ) {
      toast.error("Revisa los precios y las cantidades antes de guardar");
      return;
    }
    // Tax is opt-in: a positive rate keeps the product taxable, while 0 or an
    // empty field marks it NOT taxable (rate forced to 0 server-side). Sending
    // taxable:true with a 0 rate would be rejected by the backend, silently
    // keeping the old rate — so derive taxable from the entered rate.
    const taxData = resolveTaxFields(taxRateInput);
    // Hidden inventory fields must not leak stale values into a service or an
    // untracked product. Keep type and tracking explicit in both payloads.
    const stockData =
      isService(formData)
        ? { type: "SERVICE" as const, tracksStock: false, stock: 0, minStock: 0 }
        : formData.tracksStock === false
          ? { type: "PRODUCT" as const, tracksStock: false, stock: 0, minStock: 0 }
          : {
              type: "PRODUCT" as const,
              tracksStock: true,
              stock: formData.stock ?? 0,
              minStock: formData.minStock ?? 5,
            };
    // Promotion: empty type = no offer (explicit nulls clear it server-side);
    // a selected type requires a positive value.
    const hasPromotion = promotionTypeInput !== "";
    let parsedPromotionValue: number | null = null;
    if (hasPromotion) {
      parsedPromotionValue = Number(promotionValueInput);
      if (
        promotionValueInput.trim() === "" ||
        Number.isNaN(parsedPromotionValue) ||
        parsedPromotionValue <= 0
      ) {
        toast.error("Ingresa un valor de oferta valido");
        return;
      }
    }

    saveInProgressRef.current = true;
    setIsSaving(true);
    try {
      // Generic upload does not mutate the product. Retain its URL in the draft
      // if the subsequent save fails so a retry does not upload the file twice.
      let imageUrl = formData.imageUrl;
      if (pendingImageFile) {
        const result = await uploadProductImage.mutateAsync(pendingImageFile);
        if (!result.imageUrl) throw new Error("No se recibió la URL de la imagen");
        imageUrl = result.imageUrl;
        setFormData((previous) => ({ ...previous, imageUrl }));
        setPendingImageFile(null);
      }
      if (editingProduct) {
        const updateData = { ...formData };
        delete updateData.id;
        delete updateData.createdAt;
        delete updateData.updatedAt;
        delete updateData.category;
        delete updateData.imageUrl;
        delete updateData.version;
        delete updateData.categoryId;
        delete updateData.taxRate;
        delete updateData.effectiveTaxRate;
        delete updateData.effectiveSalePrice;
        delete updateData.isLowStock;
        delete updateData.preferredSupplierId;
        delete updateData.organizationId;
        delete updateData.promotionType;
        delete updateData.promotionValue;
        const cleanedData = {
          ...updateData,
          ...(normalizedCategoryId ? { categoryId: normalizedCategoryId } : {}),
          ...taxData,
          costPrice: updateData.costPrice ?? 0,
          salePrice: updateData.salePrice ?? 0,
          ...stockData,
          ...(imageUrl !== editingProduct.imageUrl ? { imageUrl: imageUrl || "" } : {}),
          promotionType: hasPromotion ? promotionTypeInput : null,
          promotionValue:
            hasPromotion && parsedPromotionValue !== null
              ? parsedPromotionValue
              : null,
        };
        await updateProduct.mutateAsync({
          id: editingProduct.id,
          data: cleanedData,
        });
      } else {
        const cleanedFormData = {
          ...formData,
          ...(imageUrl ? { imageUrl } : {}),
          categoryId: normalizedCategoryId,
          ...taxData,
          costPrice: formData.costPrice ?? 0,
          salePrice: formData.salePrice ?? 0,
          ...stockData,
          promotionType: hasPromotion ? promotionTypeInput : null,
          promotionValue:
            hasPromotion && parsedPromotionValue !== null
              ? parsedPromotionValue
              : null,
        };
        await createProduct.mutateAsync(cleanedFormData as Product);
        toast.success("Producto creado correctamente");
      }
      if (editingProduct) toast.success("Producto actualizado correctamente");
      saveInProgressRef.current = false;
      closeEditor();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al guardar el producto"));
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // "Captura" mode: pressing Enter on a focused barcode field must NOT submit
    // the form (which would save a product mid-scan). We preventDefault and
    // advance focus to the Name field instead. Applied on BOTH create and edit
    // so scanning a code during an edit also respects capture-and-advance; the
    // auto-focus to barcode itself is create-only (see effect below).
    e.preventDefault();
    nameInputRef.current?.focus();
  };

  // Auto-focus the barcode field when the modal opens to CREATE (editingProduct
  // === null). When editing an existing product we do NOT steal focus to the
  // barcode field, leaving the default focus behavior intact. rAF defers to the
  // next frame so the conditionally-rendered Modal has mounted the field.
  useEffect(() => {
    if (!showModal || editingProduct) return;
    const scheduleFocus =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
    const frameId = scheduleFocus(() => {
      barcodeInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [showModal, editingProduct]);

  const hasFilter =
    selectedCategory || showLowStockOnly || statusFilter !== "active";
  const isEditingInactive = Boolean(editingProduct && !editingProduct.active);

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-1 h-7 rounded-full bg-primary shrink-0" />
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
                Inventario
              </h1>
              {meta && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                  {meta.total} productos
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-4">
              Gestiona productos, precios y existencias
            </p>
          </div>
          {canManageInventory && (
            <Button onClick={handleCreate} disabled={isSaving} className="w-full sm:w-auto shrink-0">
              <Plus className="w-4 h-4" />
              Nuevo Producto
            </Button>
          )}
        </div>

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={updateSearch}
          searchPlaceholder="Buscar por nombre, SKU..."
          filterControls={
            <>
              <BentoSelect
                value={statusFilter}
                onChange={updateStatusFilter}
                className="w-36"
                placeholder="Estado"
                options={[
                  { value: "active", label: "Activos" },
                  { value: "inactive", label: "Inactivos" },
                  { value: "all", label: "Todos" },
                ]}
              />
              <BentoSelect
                value={selectedCategory || ""}
                onChange={(value) => updateSelectedCategory(value || null)}
                className={cn("w-52", selectedCategory && "border-primary/40")}
                placeholder="Todas las categorías"
                options={[
                  { value: "", label: "Todas las categorías" },
                  ...categories.map((cat) => ({
                    value: cat.id,
                    label: cat.name,
                  })),
                ]}
              />
              <button
                onClick={toggleLowStockOnly}
                aria-pressed={showLowStockOnly}
                className={cn(
                  "flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all border",
                  showLowStockOnly
                    ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                    : "bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground",
                )}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Stock Bajo</span>
                {lowStockProducts.length > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0",
                      showLowStockOnly
                        ? "bg-red-500 text-white"
                        : "bg-red-500/20 text-red-600 dark:text-red-400",
                    )}
                  >
                    {lowStockProducts.length}
                  </span>
                )}
              </button>
            </>
          }
          postContent={
            hasFilter ? (
              <div className="flex items-center gap-2 px-4 py-2 border-t border-border/40 bg-muted/20">
                <SlidersHorizontal className="w-3 h-3 text-primary/60 shrink-0" />
                <span className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {displayProducts.length}
                  </span>{" "}
                  resultado{displayProducts.length !== 1 ? "s" : ""}
                  {selectedCategory && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="text-primary">
                        {categories.find((c) => c.id === selectedCategory)?.name}
                      </span>
                    </>
                  )}
                  {showLowStockOnly && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="text-red-500 dark:text-red-400">
                        stock bajo
                      </span>
                    </>
                  )}
                  {statusFilter !== "active" && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="text-primary">
                        {statusFilter === "inactive" ? "inactivos" : "todos"}
                      </span>
                    </>
                  )}
                </span>
              </div>
            ) : undefined
          }
        />

        {/* Low stock alert */}
        {/* {lowStockProducts.length > 0 &&
          !showLowStockOnly &&
          !selectedCategory && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl border"
              style={{
                backgroundColor: "rgba(239,68,68,0.06)",
                borderColor: "rgba(239,68,68,0.2)",
              }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: "rgba(239,68,68,0.12)" }}
              >
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {lowStockProducts.length} producto
                  {lowStockProducts.length !== 1 ? "s" : ""} con stock bajo
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setLowStockFilter({ urlValue: urlLowStock, enabled: true })}
              >
                Ver todos
              </Button>
            </div>
          )} */}

        {/* Content */}
        {isLoading ? (
          <LoadingState icon={<Package className="w-4 h-4 text-primary/50" />} message="Cargando productos..." />
        ) : displayProducts.length === 0 ? (
          <EmptyState
            icon={<Package className="w-6 h-6 text-muted-foreground/30" />}
            title={hasFilter ? "No se encontraron productos" : "No hay productos aún"}
            subtitle={hasFilter ? "Intenta con otros filtros" : "Crea tu primer producto"}
          />
        ) : (
          <>
            {isFetching && (
              <div
                role="status"
                className="sr-only"
              >
                Actualizando productos...
              </div>
            )}
            <div
              className="grid auto-rows-fr grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 lg:gap-4.5"
              aria-busy={isFetching}
            >
              {displayProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  mode="inventory"
                  product={product}
                  onClick={
                    canManageInventory ? () => handleEdit(product) : undefined
                  }
                  onDelete={
                    canManageInventory && product.active
                      ? () => handleDeactivate(product.id)
                      : undefined
                  }
                  onReactivate={
                    canManageInventory && !product.active
                      ? () => handleReactivate(product.id)
                      : undefined
                  }
                />
              ))}
            </div>

            {meta && meta.totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                totalItems={meta.total}
                itemLabel="producto"
                isDisabled={isFetching}
              />
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={canManageInventory && showModal}
        onClose={closeEditor}
        title={editingProduct ? "Editar Producto" : "Nuevo Producto"}
        size="lg"
      >
        <form
          onSubmit={handleSubmit}
          onChangeCapture={(event) => {
            if (saveInProgressRef.current) event.stopPropagation();
          }}
          aria-busy={isSaving}
          className="mx-auto w-full max-w-3xl sm:px-4 sm:py-2"
        >
          <fieldset disabled={isSaving} className="m-0 w-full min-w-0 space-y-5 border-0 p-0 sm:space-y-7">
          <div role="group" aria-label="Identidad" className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold text-primary">Datos del producto</h3>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <div className="w-full min-w-0">
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  Imagen del producto
                </p>
                <ImageUpload
                  variant="hero"
                  value={formData.imageUrl || ""}
                  file={pendingImageFile}
                  onFileChange={setPendingImageFile}
                  onChange={(url) => setFormData((previous) => ({ ...previous, imageUrl: url }))}
                  disabled={isSaving || uploadProductImage.isPending || createProduct.isPending || updateProduct.isPending}
                />
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Input
                    ref={nameInputRef}
                    label="Nombre"
                    value={formData.name || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
                <Input
                  label="SKU"
                  value={formData.sku || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, sku: e.target.value })
                  }
                  required
                />
                <Input
                  ref={barcodeInputRef}
                  label="Código de Barras"
                  value={formData.barcode || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, barcode: e.target.value })
                  }
                  onKeyDown={handleBarcodeKeyDown}
                />
                <BentoSelect
                  label="Categoría"
                  value={formData.categoryId || ""}
                  onChange={(value) =>
                    setFormData({ ...formData, categoryId: value })
                  }
                  options={[
                    { value: "", label: "Seleccionar categoría" },
                    ...categories.map((cat) => ({
                      value: cat.id,
                      label: cat.name,
                    })),
                  ]}
                />
                <BentoSelect
                  label="Tipo"
                  value={formData.type === "SERVICE" ? "SERVICE" : "PRODUCT"}
                  onChange={(value) =>
                    setFormData({
                      ...formData,
                      type: value === "SERVICE" ? "SERVICE" : "PRODUCT",
                    })
                  }
                  options={[
                    { value: "PRODUCT", label: "Producto" },
                    { value: "SERVICE", label: "Servicio" },
                  ]}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Descripción"
                    value={formData.description || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    textarea
                    rows={3}
                  />
                </div>
              </div>
            </div>
          </div>

          <div role="group" aria-label="Precios" className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold text-primary">Precios e impuesto</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              <CurrencyInput
                label="Precio de Costo"
                value={formData.costPrice || ""}
                onChange={(value) =>
                  setFormData({ ...formData, costPrice: value })
                }
                required
              />
              <CurrencyInput
                label="Precio de Venta"
                value={formData.salePrice || ""}
                onChange={(value) =>
                  setFormData({ ...formData, salePrice: value })
                }
                required
              />
              <Input
                label="Impuesto (%)"
                type="number"
                step="0.01"
                value={taxRateInput}
                onChange={(e) => setTaxRateInput(e.target.value)}
              />
            </div>
          </div>

          {!isService(formData) && (
            <div role="group" aria-label="Inventario" className="min-w-0 space-y-3">
              <h3 className="text-sm font-semibold text-primary">Inventario</h3>
              <div className="flex items-center gap-2">
                <input
                  id="tracksStock"
                  type="checkbox"
                  checked={formData.tracksStock !== false}
                  onChange={(e) =>
                    setFormData({ ...formData, tracksStock: e.target.checked })
                  }
                />
                <label htmlFor="tracksStock" className="text-sm text-foreground">
                  Maneja inventario
                </label>
              </div>
              {formData.tracksStock !== false && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <Input
                    label="Stock"
                    type="number"
                    value={formData.stock || 0}
                    onChange={(e) =>
                      setFormData({ ...formData, stock: Number(e.target.value) })
                    }
                    required
                  />
                  <Input
                    label="Stock Mín."
                    type="number"
                    value={formData.minStock || 5}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        minStock: Number(e.target.value),
                      })
                    }
                    required
                  />
                </div>
              )}
            </div>
          )}

          <div role="group" aria-label="Oferta" className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold text-primary">Oferta</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="w-full min-w-0 sm:max-w-64">
                <BentoSelect
                  value={promotionTypeInput}
                  onChange={(value) =>
                    setPromotionTypeInput(
                      value === "PERCENTAGE" || value === "FIXED_PRICE"
                        ? value
                        : "",
                    )
                  }
                  placeholder="Sin oferta"
                  options={[
                    { value: "", label: "Sin oferta" },
                    { value: "PERCENTAGE", label: "Porcentaje" },
                    { value: "FIXED_PRICE", label: "Precio fijo" },
                  ]}
                />
              </div>
              {promotionTypeInput !== "" && (
                <>
                  <div className="w-full min-w-0 sm:max-w-56">
                    {promotionTypeInput === "FIXED_PRICE" ? (
                      <CurrencyInput
                        placeholder="Valor"
                        value={promotionValueInput}
                        onChange={(value) =>
                          setPromotionValueInput(String(value))
                        }
                        className="w-full"
                      />
                    ) : (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Valor"
                        value={promotionValueInput}
                        onChange={(e) =>
                          setPromotionValueInput(e.target.value)
                        }
                        className="w-full"
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    title="Quitar oferta"
                    aria-label="Quitar oferta"
                    onClick={() => {
                      setPromotionTypeInput("");
                      setPromotionValueInput("");
                    }}
                    className="self-start px-3"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end pt-3 border-t border-border/40">
            {editingProduct?.active && (
              <Button
                type="button"
                variant="danger"
                onClick={() => handleDelete(editingProduct.id)}
                className="w-full sm:mr-auto sm:w-auto"
              >
                Eliminar definitivo
              </Button>
            )}
            {isEditingInactive && editingProduct && (
              <Button
                type="button"
                variant="danger"
                onClick={() => handleDelete(editingProduct.id)}
                className="w-full sm:mr-auto sm:w-auto"
              >
                Eliminar definitivo
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={closeEditor}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createProduct.isPending || updateProduct.isPending || uploadProductImage.isPending}
              disabled={isEditingInactive || isSaving}
              className="w-full sm:w-auto"
            >
              {isEditingInactive
                ? "Reactivar desde la tarjeta"
                : editingProduct
                  ? "Actualizar"
                  : "Crear"}
            </Button>
          </div>
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={canManageInventory && showDeactivateModal}
        onClose={() => {
          setShowDeactivateModal(false);
          setProductToDeactivate(null);
        }}
        onConfirm={confirmDeactivate}
        title="Desactivar Producto"
        message="¿Estás seguro de que deseas desactivar este producto? Podrás reactivarlo más adelante."
        confirmText="Desactivar"
        cancelText="Cancelar"
      />

      <ConfirmDialog
        isOpen={canManageInventory && showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setProductToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Eliminar Producto Definitivamente"
        message="Esta acción elimina el producto de forma permanente. Si tiene ventas o movimientos asociados, no se podrá eliminar."
        confirmText="Eliminar"
        cancelText="Cancelar"
      />

      <ConfirmDialog
        isOpen={canManageInventory && showReactivateModal}
        onClose={() => {
          setShowReactivateModal(false);
          setProductToReactivate(null);
        }}
        onConfirm={confirmReactivate}
        title="Reactivar Producto"
        message="¿Deseas reactivar este producto para volver a venderlo y gestionarlo en inventario?"
        confirmText="Reactivar"
        cancelText="Cancelar"
      />
    </DashboardLayout>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<LoadingState icon={<Package className="w-4 h-4 text-primary/50" />} message="Cargando productos..." />}>
      <InventoryContent />
    </Suspense>
  );
}
