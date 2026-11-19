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
import { INVENTORY_GRID_CLASSES } from "@/components/ui/collectionGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ImageUpload } from "@/components/ui/ImageUpload";
import { Select } from "@/components/ui/Select";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Pagination } from "@/components/ui/Pagination";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Badge } from "@/components/ui/Badge";
import {
  FilterBar,
} from "@/components/ui/FilterBar";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { ProductCard } from "@/components/products/ProductCard";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { useEffectiveViewMode, useMediaQuery } from "@/hooks/useEffectiveViewMode";
import { useResponsivePageSize } from "@/hooks/useResponsivePageSize";
import {
  COLLECTION_GRID_GAP,
  INVENTORY_CARD_MIN_WIDTH,
  INVENTORY_WIDE_TRACK_QUERY,
  MAX_COLLECTION_PAGE_SIZE,
  MIN_VISIBLE_ROWS,
  PRODUCT_CARD_MIN_ROW_HEIGHT,
  PRODUCT_CARD_MIN_WIDTH,
  inventoryGridRows,
  remapPageForPageSize,
} from "@/lib/collection-grid";
import { shouldAutoFocusTextInput } from "@/lib/input-focus";
import {
  Plus,
  AlertTriangle,
  Package,
  Power,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Product } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn, formatCurrency, resolveTaxFields, toFiniteNumber } from "@/lib/utils";
import { isService, tracksStock } from "@/lib/product-type";
import { hasAnyRole } from "@/lib/auth";

/** Table view: a dense list keeps the page it always had. */
const TABLE_PAGE_SIZE = 10;

function InventoryContent() {
  const searchParams = useSearchParams();
  const urlLowStock = searchParams?.get("filter") === "lowStock";
  // The command palette links a product hit here with `?search=<sku>`.
  const urlSearch = searchParams?.get("search") ?? "";
  const toast = useToast();
  const { user } = useAuth();
  const canManageInventory = hasAnyRole(user?.role, ["ADMIN", "INVENTORY_USER"]);
  const [search, setSearch] = useState(() => urlSearch);
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
  // Only the URL's value, so a manual edit of the field is never overwritten.
  const [urlSearchState, setUrlSearchState] = useState(urlSearch);
  const urlSearchChanged = urlSearchState !== urlSearch;

  // Adjust only on URL transitions: unrelated renders must preserve manual toggles.
  // Resolve the new query immediately, without fetching a stale page/filter first.
  if (urlFilterChanged) {
    setLowStockFilter({ urlValue: urlLowStock, enabled: urlLowStock });
    setPage(1);
  }

  // Same rule for the palette's arrival: adopt `?search=` on the transition and
  // land on the first page of it, without discarding the filters already set.
  if (urlSearchChanged) {
    setUrlSearchState(urlSearch);
    setSearch(urlSearch);
    setPage(1);
  }
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useEffectiveViewMode("inventory");
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

  // Card view asks the grid how many cards fit; table view fits whole rows
  // between the table top and the pager. Both answer TABLE_PAGE_SIZE until measured.
  // The grid's track widens from `lg` (see INVENTORY_GRID_CLASSES), so the width the
  // page counts with follows the same breakpoint; when the viewport cannot be
  // measured the narrower track stands, which just asks for fewer columns.
  const wideInventoryTracks = useMediaQuery(INVENTORY_WIDE_TRACK_QUERY, false);
  const {
    pageSize: gridPageSize,
    columns: gridColumns,
    rows: gridRows,
    containerRef: gridRef,
    footerRef,
    tableRef,
  } = useResponsivePageSize({
    minCardWidth: wideInventoryTracks ? INVENTORY_CARD_MIN_WIDTH : PRODUCT_CARD_MIN_WIDTH,
    gap: COLLECTION_GRID_GAP,
    rowHeight: PRODUCT_CARD_MIN_ROW_HEIGHT,
    // Rows stretch to the space above the pager, so a rendered card is taller than
    // its row: measuring it would ask for fewer rows, which stretches it further.
    measureRowHeight: false,
    minRows: MIN_VISIBLE_ROWS,
    min: TABLE_PAGE_SIZE,
    max: MAX_COLLECTION_PAGE_SIZE,
    enabled: viewMode === "grid",
  });
  // From `lg` the grid stretches its rows into the height above the pager, so the page
  // must hold exactly the cards that fit: the hook's floor would add a row that scrolls
  // under the pinned pager (1366x768 fits four columns and two rows, not ten cards).
  // Below `lg` the floor stands, so a phone keeps the list it always had.
  const pageSize =
    wideInventoryTracks && gridColumns > 0
      ? Math.min(gridColumns * gridRows, MAX_COLLECTION_PAGE_SIZE)
      : gridPageSize;
  // One equal track per row, written inline: CSS `auto-fill` would choose its own track
  // count and leave the leftover height unevenly distributed. The track count is the
  // measured one whatever the card count, so a short last page keeps a full page's card
  // height instead of one tall row.
  const gridRowStyle =
    wideInventoryTracks && gridRows > 0
      ? { gridTemplateRows: inventoryGridRows(gridRows) }
      : undefined;

  // Server-side pagination: every request — filtered or not — is bounded to
  // one page of rows. Low stock and alphabetical order are resolved by the
  // backend (findAll lowStock/orderBy) so pages stay coherent.
  const {
    data,
    isLoading,
    isFetching,
    isError: productsFailed,
    error: productsError,
    refetch: refetchProducts,
  } = useProducts({
    page: urlFilterChanged || urlSearchChanged ? 1 : page,
    limit: pageSize,
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

  // A resize changes how many cards a page holds. Re-anchor on the item the user
  // was already looking at instead of leaving them on a page that now starts
  // somewhere else. One settle, one request: the debounced hook reports each
  // size once.
  const previousPageSize = useRef(pageSize);
  useEffect(() => {
    const previous = previousPageSize.current;
    if (previous === pageSize) return;
    previousPageSize.current = pageSize;
    const nextPage = remapPageForPageSize({ page, previousSize: previous, nextSize: pageSize });
    if (nextPage !== page) setPage(nextPage);
  }, [pageSize, page]);

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
  // ...but the badge counts the whole filtered catalog, not this page's slice: the
  // server serves that total in meta so the number always matches the list the click
  // opens. `lowStockProducts` stays the page-level view for rendering.
  const lowStockCount = meta?.lowStockCount ?? lowStockProducts.length;
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
        toast.error("Ingresa un valor de oferta válido");
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
      // Explicit allowlist. The product returned by the API carries
      // server-owned fields (reservedStock, availableStock, isLowStock,
      // effectiveSalePrice, version, timestamps…) that the whitelisted DTO
      // rejects; spreading it into the body is what broke editing. Building
      // the body from the fields the form actually owns keeps every future
      // server field out of the request.
      const editableFields = {
        name: formData.name?.trim() ?? "",
        sku: formData.sku?.trim() ?? "",
        barcode: formData.barcode?.trim() ?? "",
        description: formData.description ?? "",
        costPrice: formData.costPrice ?? 0,
        salePrice: formData.salePrice ?? 0,
        ...taxData,
        ...stockData,
        categoryId: normalizedCategoryId,
        promotionType: hasPromotion ? promotionTypeInput : null,
        promotionValue:
          hasPromotion && parsedPromotionValue !== null
            ? parsedPromotionValue
            : null,
      };

      if (editingProduct) {
        const nextImage = imageUrl ?? null;
        await updateProduct.mutateAsync({
          id: editingProduct.id,
          data: {
            ...editableFields,
            ...(nextImage !== editingProduct.imageUrl
              ? { imageUrl: nextImage ?? "" }
              : {}),
          },
        });
      } else {
        await createProduct.mutateAsync({
          ...editableFields,
          ...(imageUrl ? { imageUrl } : {}),
        });
      }
      if (editingProduct) toast.success("Producto actualizado correctamente");
      else toast.success("Producto creado correctamente");
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
    // This move is not gated on the pointer: it answers the reader's own Enter
    // on a field they are already typing in, which is a request to type here.
    e.preventDefault();
    nameInputRef.current?.focus();
  };

  // Auto-focus the barcode field when the modal opens to CREATE (editingProduct
  // === null). When editing an existing product we do NOT steal focus to the
  // barcode field, leaving the default focus behavior intact. rAF defers to the
  // next frame so the conditionally-rendered Modal has mounted the field.
  // Opening a form is the app taking the focus by itself, so a phone keeps its
  // keyboard closed and only a pointer that can type asks for the field.
  useEffect(() => {
    if (!showModal || editingProduct) return;
    if (!shouldAutoFocusTextInput()) return;
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
      <div className="flex flex-1 flex-col gap-4 lg:gap-5">
        {/* Page Header */}
<PageHeader
          title="Inventario"
          subtitle="Gestiona productos, precios y existencias"
          count={meta ? `${meta.total} productos` : undefined}
          actions={
            canManageInventory ? (
              <Button
                onClick={handleCreate}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                <Plus className="w-4 h-4" /> Nuevo producto
              </Button>
            ) : undefined
          }
        />

        {/* Filter Bar */}
        <FilterBar
          searchValue={search}
          onSearchChange={updateSearch}
          searchPlaceholder="Buscar por nombre, SKU..."
          filterControls={
            <>
              <Select
                value={statusFilter}
                onChange={updateStatusFilter}
                className="w-full sm:w-36 shrink-0"
                placeholder="Estado"
                options={[
                  { value: "active", label: "Activos" },
                  { value: "inactive", label: "Inactivos" },
                  { value: "all", label: "Todos" },
                ]}
              />
              <Select
                value={selectedCategory || ""}
                onChange={(value) => updateSelectedCategory(value || null)}
                className="w-full sm:w-52 shrink-0"
                placeholder="Todas las categorías"
                options={[
                  { value: "", label: "Todas las categorías" },
                  ...categories.map((cat) => ({
                    value: cat.id,
                    label: cat.name,
                  })),
                ]}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={toggleLowStockOnly}
                aria-pressed={showLowStockOnly}
                className={cn(
                  "shrink-0 gap-1.5",
                  showLowStockOnly && "border-danger/35 bg-danger/10 text-danger-text hover:bg-danger/15",
                )}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Stock bajo</span>
                {lowStockCount > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-xs font-semibold tabular-nums shrink-0",
                      showLowStockOnly
                        ? "bg-danger text-white"
                        : "bg-danger/15 text-danger-text",
                    )}
                  >
                    {lowStockCount}
                  </span>
                )}
              </Button>
              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => {
                  setPage(1);
                  setViewMode(mode);
                }}
              />
            </>
          }
          postContent={
            hasFilter ? (
              <div className="flex items-center gap-2 mt-2 pt-2 px-1 border-t border-border/60">
                <SlidersHorizontal className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-[13px] text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">
                    {displayProducts.length}
                  </span>{" "}
                  resultado{displayProducts.length !== 1 ? "s" : ""}
                  {selectedCategory && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-medium text-foreground">
                        {categories.find((c) => c.id === selectedCategory)?.name}
                      </span>
                    </>
                  )}
                  {showLowStockOnly && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-medium text-danger-text">
                        stock bajo
                      </span>
                    </>
                  )}
                  {statusFilter !== "active" && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-medium text-foreground">
                        {statusFilter === "inactive" ? "inactivos" : "todos"}
                      </span>
                    </>
                  )}
                </span>
              </div>
            ) : undefined
          }
        />

        {/* Content */}
        {productsFailed && !data ? (
          <ErrorState
            message={getApiErrorMessage(productsError, "No se pudieron cargar los productos.")}
            retryLabel="Reintentar"
            onRetry={() => void refetchProducts()}
          />
        ) : isLoading ? (
          <CardSkeleton count={6} label="Cargando productos..." />
        ) : displayProducts.length === 0 ? (
          <EmptyState
            icon={<Package className="w-5 h-5 text-muted-foreground" />}
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
            {viewMode === "grid" ? (
              <div
                ref={gridRef}
                style={gridRowStyle}
                className={cn(INVENTORY_GRID_CLASSES, "flex-1 content-start justify-items-center")}
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
            ) : (
              <div className="w-full rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden flex-1">
                <div ref={tableRef} className="overflow-x-auto">
                  <Table variant="default" className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Producto
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          SKU
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Categoría
                        </TableCell>
                        <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                          Costo
                        </TableCell>
                        <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                          Precio venta
                        </TableCell>
                        <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                          Existencias
                        </TableCell>
                        <TableCell as="th" className="text-left text-xs font-medium text-muted-foreground">
                          Estado
                        </TableCell>
                        {canManageInventory && (
                          <TableCell as="th" className="text-right text-xs font-medium text-muted-foreground">
                            Acciones
                          </TableCell>
                        )}
                      </TableRow>
                    </TableHeader>
                    <tbody>
                      {displayProducts.map((product) => {
                        const hasPromo =
                          typeof product.effectiveSalePrice === "number" &&
                          Number(product.effectiveSalePrice) !== Number(product.salePrice);
                        const sellingPrice = Number(
                          hasPromo ? product.effectiveSalePrice : product.salePrice,
                        );
                        const isUntracked = !tracksStock(product);
                        const isSrv = isService(product);
                        return (
                          <TableRow
                            key={product.id}
                            onClick={
                              canManageInventory ? () => handleEdit(product) : undefined
                            }
                            className={cn(
                              canManageInventory && "cursor-pointer active:bg-muted/40",
                              product.active === false && "opacity-60",
                            )}
                          >
                            <TableCell className="text-sm">
                              {canManageInventory ? (
                                <button
                                  type="button"
                                  aria-label={`Editar ${product.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleEdit(product);
                                  }}
                                  className="text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
                                >
                                  {product.name}
                                </button>
                              ) : (
                                <span className="font-medium text-foreground">
                                  {product.name}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="id-text text-xs text-muted-foreground">
                              {product.sku}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 text-[13px] font-medium text-foreground">
                                {product.category?.name || "Sin categoría"}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-right tabular-nums text-muted-foreground">
                              {formatCurrency(toFiniteNumber(product.costPrice))}
                            </TableCell>
                            <TableCell className="text-sm text-right font-semibold tabular-nums text-foreground">
                              {formatCurrency(sellingPrice)}
                              {hasPromo && (
                                <s className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  {formatCurrency(toFiniteNumber(product.salePrice))}
                                </s>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-right tabular-nums">
                              {isSrv ? (
                                <span className="text-muted-foreground">Servicio</span>
                              ) : isUntracked ? (
                                <span className="text-muted-foreground">Sin conteo</span>
                              ) : (
                                <span
                                  className={cn(
                                    "font-semibold",
                                    product.stock === 0
                                      ? "text-danger-text"
                                      : product.isLowStock
                                        ? "text-warning-text"
                                        : "text-foreground",
                                  )}
                                >
                                  {product.stock} uds.
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {product.active === false ? (
                                <Badge variant="default" dot>
                                  Inactivo
                                </Badge>
                              ) : !isSrv && !isUntracked && product.stock === 0 ? (
                                <Badge variant="danger" dot>
                                  Agotado
                                </Badge>
                              ) : product.isLowStock ? (
                                <Badge variant="warning" dot>
                                  Stock bajo
                                </Badge>
                              ) : (
                                <Badge variant="success" dot>
                                  Activo
                                </Badge>
                              )}
                            </TableCell>
                            {canManageInventory && (
                              <TableCell className="text-right">
                                <div
                                  className="inline-flex items-center justify-end"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {product.active ? (
                                    <button
                                      type="button"
                                      onClick={() => handleDeactivate(product.id)}
                                      title="Desactivar producto"
                                      aria-label={`Desactivar producto ${product.name}`}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger-text"
                                    >
                                      <Power className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleReactivate(product.id)}
                                      title="Reactivar producto"
                                      aria-label={`Reactivar producto ${product.name}`}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-success/30 hover:bg-success/10 hover:text-success-text"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
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
              // `contents` keeps the pager a direct flex child (its sticky
              // bottom and mt-auto still work) while giving the sizing hook a
              // box to measure the footer height from.
              <div ref={footerRef} className="contents">
                <Pagination
                  currentPage={page}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  totalItems={meta.total}
                  pageSize={pageSize}
                  itemLabel="producto"
                  isDisabled={isFetching}
                />
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={canManageInventory && showModal}
        onClose={closeEditor}
        title={editingProduct ? "Editar producto" : "Nuevo producto"}
        size="lg"
      >
        <form
          onSubmit={handleSubmit}
          onChangeCapture={(event) => {
            if (saveInProgressRef.current) event.stopPropagation();
          }}
          aria-busy={isSaving}
          className="mx-auto w-full max-w-4xl"
        >
          <fieldset disabled={isSaving} className="m-0 w-full min-w-0 space-y-5 border-0 p-0">
          <div role="group" aria-label="Identidad" className="min-w-0 space-y-3">
            <h3 className="text-[13px] font-semibold text-foreground">Datos del producto</h3>
            <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,19.5rem)_minmax(0,1fr)]">
              <div className="w-full min-w-0">
                <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">
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
                <Select
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
                <Select
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
                    rows={2}
                  />
                </div>
                <div role="group" aria-label="Oferta" className="sm:col-span-2 min-w-0 space-y-1.5">
                  <h3 className="text-[13px] font-medium text-muted-foreground">Oferta</h3>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="w-full min-w-0 sm:flex-1">
                      <Select
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
                        <div className="w-full min-w-0 sm:flex-1">
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
                          className="self-start h-10 sm:h-9 w-10 sm:w-9 p-0 shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div role="group" aria-label="Precios" className="min-w-0 space-y-3 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-foreground">Precios e impuesto</h3>
              {(() => {
                const cost = toFiniteNumber(formData.costPrice);
                const sale = toFiniteNumber(formData.salePrice);
                if (sale <= 0 && cost <= 0) return null;
                const profit = sale - cost;
                const marginPct = sale > 0 ? Math.round((profit / sale) * 100) : 0;
                const isNegative = profit < 0;
                return (
                  <Badge
                    variant={isNegative ? "danger" : "success"}
                    className="gap-1.5 text-xs tabular-nums"
                  >
                    <span>Utilidad: {profit >= 0 ? "+" : ""}{formatCurrency(profit)}</span>
                    {sale > 0 && <span>· {marginPct}%</span>}
                  </Badge>
                );
              })()}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
              <CurrencyInput
                label="Precio de costo"
                value={formData.costPrice || ""}
                onChange={(value) =>
                  setFormData({ ...formData, costPrice: value })
                }
                required
              />
              <CurrencyInput
                label="Precio de venta"
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
            <div role="group" aria-label="Inventario" className="min-w-0 space-y-3 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-foreground">Inventario</h3>
                <label
                  htmlFor="tracksStock"
                  className="inline-flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer select-none"
                >
                  <input
                    id="tracksStock"
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    checked={formData.tracksStock !== false}
                    onChange={(e) =>
                      setFormData({ ...formData, tracksStock: e.target.checked })
                    }
                  />
                  Maneja inventario
                </label>
              </div>
              {formData.tracksStock !== false && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
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
                    label="Stock mín."
                    type="number"
                    value={formData.minStock ?? 0}
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

          <div className="flex flex-col sm:flex-row gap-2 justify-end pt-4 border-t border-border/60">
            {editingProduct?.active && (
              <Button
                type="button"
                variant="danger"
                onClick={() => handleDelete(editingProduct.id)}
                className="w-full sm:mr-auto sm:w-auto sm:min-w-[132px]"
              >
                Eliminar definitivo
              </Button>
            )}
            {isEditingInactive && editingProduct && (
              <Button
                type="button"
                variant="danger"
                onClick={() => handleDelete(editingProduct.id)}
                className="w-full sm:mr-auto sm:w-auto sm:min-w-[132px]"
              >
                Eliminar definitivo
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={closeEditor}
              className="w-full sm:w-auto sm:min-w-[132px] px-6"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createProduct.isPending || updateProduct.isPending || uploadProductImage.isPending}
              disabled={isEditingInactive || isSaving}
              className="w-full sm:w-auto sm:min-w-[132px] px-6"
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
        title="Eliminar producto definitivamente"
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
    <Suspense fallback={<LoadingState icon={<Package className="w-4 h-4 text-muted-foreground" />} message="Cargando productos..." />}>
      <InventoryContent />
    </Suspense>
  );
}
