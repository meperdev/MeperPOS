"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Image from "next/image";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useProducts, useQuickSearchProduct } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { useCustomers } from "@/hooks/useCustomers";
import { useCreateSale } from "@/hooks/useSales";
import { useCreatePosLoan } from "@/hooks/useLoans";
import { usePausedSales } from "@/hooks/usePausedSales";
import { printReceipt, printThermalReceipt } from "@/hooks/useReceipt";
import { useSettings } from "@/hooks/useSettings";
import { Input } from "@/components/ui/Input";
import { SearchField } from "@/components/ui/SearchField";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Button } from "@/components/ui/Button";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Badge } from "@/components/ui/Badge";
import { Stepper } from "@/components/ui/Stepper";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { DynamicFallback } from "@/components/ui/DynamicFallback";
import { prefetchOnIdle } from "@/lib/prefetch";
import dynamic from "next/dynamic";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";
import { MobileCartFloatingBar } from "@/components/pos/MobileCartFloatingBar";
import { ProductCard } from "@/components/products/ProductCard";
import {
  Search,
  Star,
  Trash2,
  ShoppingCart,
  Printer,
  FileDown,
  Package,
  Percent,
  Pause,
  Play,
  User,
  Wrench,
  HandCoins,
} from "lucide-react";
import { cn, formatCurrency, safeGetItem, safeSetItem } from "@/lib/utils";
import { effectiveStock } from "@/lib/product-type";
import type { CartItem, Product, Sale } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { hasAnyRole } from "@/lib/auth";
import { api, getApiErrorMessage } from "@/lib/api";

import { observePOSGrid, POS_GRID_TEMPLATE_COLUMNS } from "./pos-layout";

// S1 code splitting (#98): the payment modal and mobile cart drawer are the
// heaviest POS-only components; they load as separate chunks on first open
// and are prefetched once the browser is idle after mount.
const loadPaymentConfirmationModal = () =>
  import("@/components/pos/PaymentConfirmationModal").then((m) => ({
    default: m.PaymentConfirmationModal,
  }));
const loadMobileCartDrawer = () =>
  import("@/components/pos/MobileCartDrawer").then((m) => ({
    default: m.MobileCartDrawer,
  }));

const PaymentConfirmationModal = dynamic(loadPaymentConfirmationModal, {
  loading: () => <DynamicFallback />,
});
const MobileCartDrawer = dynamic(loadMobileCartDrawer, {
  loading: () => <DynamicFallback />,
});

/**
 * Detect whether a cart line is carrying an active product promotion based on
 * the product's backend-computed effectiveSalePrice (not on a manual price
 * override). Returns the approximate whole-percent discount, or null when the
 * line is not on offer.
 */
function cartItemOffer(item: CartItem) {
  // effectiveSalePrice is null/undefined when there is NO active promotion;
  // Number(null) would be 0, so guard the presence explicitly to avoid a
  // bogus "-100%" offer. salePrice may arrive as a Decimal string.
  const price = item.product?.effectiveSalePrice;
  const listPrice = Number(item.product?.salePrice);
  if (typeof price !== "number" || !Number.isFinite(listPrice)) return null;
  if (price <= 0 || price >= listPrice) return null;
  const percent = Math.max(
    0,
    Math.round(100 - (price / listPrice) * 100),
  );
  return percent > 0 ? { percent } : null;
}

/**
 * The price the SERVER would charge for this line: the promotion-aware
 * `effectiveSalePrice` when one is active, otherwise the list price. This is
 * the same value `SalesService.create` derives, so a line flagged here is
 * exactly the line the server treats as an override (and audits).
 */
function cartItemServerUnitPrice(item: CartItem): number | null {
  const listPrice = Number(item.product?.salePrice);
  if (!Number.isFinite(listPrice)) return null;
  const effective = item.product?.effectiveSalePrice;
  return typeof effective === "number" && Number.isFinite(effective)
    ? effective
    : listPrice;
}

/**
 * True when the line's price differs from the server-derived price — i.e. a
 * manual override rather than a promotion. Mirrors the backend's 0.01
 * tolerance so the cart never flags noise the API would consider a match.
 */
function cartItemPriceOverride(
  item: CartItem,
): { serverUnitPrice: number } | null {
  const serverUnitPrice = cartItemServerUnitPrice(item);
  if (serverUnitPrice === null) return null;
  const lineUnitPrice = Number(item.unitPrice);
  if (!Number.isFinite(lineUnitPrice)) return null;
  return Math.abs(lineUnitPrice - serverUnitPrice) > 0.01
    ? { serverUnitPrice }
    : null;
}

interface PaymentMethod {
  type: "CASH" | "CARD" | "TRANSFER";
  amount: number;
}

interface ScanFeedback {
  tone: "idle" | "success" | "warning" | "error";
  message: string;
}

const FAVORITE_PRODUCTS_KEY = "pos_favorite_product_ids";
const SERVICE_FILTER_VALUE = "__SERVICE__";
const DEFAULT_SCAN_FEEDBACK: ScanFeedback = { tone: "idle", message: "" };

/**
 * Heuristic (unified "doble intención" field) to tell a real barcode/SKU code
 * being scanned from free-text browsing. An exact barcode/SKU lookup only
 * surfaces the "not found" error when the value actually looks like a compact
 * code: no whitespace and at most 64 chars. Anything with spaces or longer is
 * treated as browse intent, so a failed exact lookup silently keeps the grid
 * filtered by the (already-run) debounced contains search.
 */
function isCompactCode(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 && !/\s/.test(trimmed);
}

export default function POSPage() {
  const toast = useToast();
  const { user, loading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(1);
  const capacityRef = useRef(1);
  const capacityAreaRef = useRef<HTMLDivElement>(null);
  const productGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // DashboardLayout withholds the grid during auth restore; attach only once
    // its DOM is mounted, and detach if loading hides it again.
    if (authLoading) return;
    const area = capacityAreaRef.current;
    const grid = productGridRef.current;
    if (!area || !grid) return;
    return observePOSGrid(area, grid, (capacity) => {
      if (capacityRef.current === capacity) return;
      capacityRef.current = capacity;
      setPageSize(capacity);
      setCurrentPage(1);
    });
  }, [authLoading]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>("");
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = safeGetItem(FAVORITE_PRODUCTS_KEY);
    if (!saved) return [];
    try {
      const parsed: unknown = JSON.parse(saved);
      // Ignore malformed entries, not valid favorites later in the saved list.
      return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string =>
        typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
      ))] : [];
    } catch {
      return [];
    }
  });
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<
    "CASH" | "CARD" | "TRANSFER"
  >("CASH");
  const [amountPaid, setAmountPaid] = useState<number | undefined>(undefined);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [editingDiscount, setEditingDiscount] = useState<string | null>(null);
  const [customDiscount, setCustomDiscount] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [showPausedSalesModal, setShowPausedSalesModal] = useState(false);
  const [pausedSaleToDelete, setPausedSaleToDelete] = useState<string | null>(
    null,
  );
  const [showDeletePausedModal, setShowDeletePausedModal] = useState(false);
  // Financing is the only action here that creates a real debt, so it waits for
  // an explicit confirmation before the initiation request is built or sent.
  const [showFinanceConfirm, setShowFinanceConfirm] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(
    DEFAULT_SCAN_FEEDBACK,
  );
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [openedFromMobileCart, setOpenedFromMobileCart] = useState(false);

  // Debounce search input: 400ms delay, reset to page 1 on new search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim());
      setCurrentPage(1);
    }, 400);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Clear the unified search/scan field: reset both the immediate value and the
  // debounced grid filter, and cancel any pending debounce so a stalled timer
  // doesn't re-apply a cleared query.
  const clearSearchInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery("");
    setDebouncedSearch("");
  }, []);

  const {
    data: queryProductsData,
    isLoading: searching,
    isFetching,
    isPlaceholderData,
    isError: productsFailed,
    error: productsError,
    refetch: refetchProducts,
  } = useProducts({
    page: currentPage,
    limit: pageSize,
    search: debouncedSearch || undefined,
    categoryId:
      selectedFilter && selectedFilter !== SERVICE_FILTER_VALUE
        ? selectedFilter
        : undefined,
    type: selectedFilter === SERVICE_FILTER_VALUE ? "SERVICE" : undefined,
    ids: showFavoritesOnly ? favoriteProductIds : undefined,
    available: true,
  });
  const { data: categoriesData } = useCategories({ limit: 100 });
  const { data: customersData } = useCustomers();
  const { data: settings } = useSettings();
  const { pausedSales, pauseSale, resumeSale, deletePausedSale } =
    usePausedSales();
  const createSale = useCreateSale();
  const createPosLoan = useCreatePosLoan();
  // An attempt is pinned to the exact payload it was minted for: a retry of the
  // same request reuses its key, while any change to the cart, customer or
  // discount mints a new one. Cleared on success so the next financing starts
  // a fresh initiation.
  const [financing, setFinancing] = useState(false);
  // Set synchronously around the request so the locks never depend on a
  // query's pending flag flushing before the response resolves.
  const financingRef = useRef(false);
  // Set when an initiation succeeded: the dialog's own close must not reopen
  // the mobile cart (the sale is done and the cart is now empty).
  const financeCompletedRef = useRef(false);
  const cartLocked = financing || createPosLoan.isPending;
  // A financing in flight owns the payload it will report back: while it is
  // pending nothing may edit the cart, the customer or the discount, or the
  // financed lines could be sold or financed a second time.
  const cartLockedRef = useRef(cartLocked);
  cartLockedRef.current = cartLocked;
  const posLoanAttemptRef = useRef<{ key: string; signature: string } | null>(
    null,
  );
  const quickSearchProduct = useQuickSearchProduct();

  // SalesService explicitly permits CASHIER as well as managers. Keep this
  // exception local: checking inherited CASHIER would also admit MEMBER.
  const canOverridePrice =
    user?.role === "CASHIER" || hasAnyRole(user?.role, ["ADMIN"]);

  // A previous page/geometry must not advertise stale totals or overflow the
  // newly sized area while its replacement is loading.
  const productsData = isPlaceholderData || productsFailed ? undefined : queryProductsData;
  const categories = useMemo(
    () => categoriesData?.data ?? [],
    [categoriesData?.data],
  );
  const filterOptions = useMemo(
    () => [
      { value: "", label: "Todas las categorías" },
      {
        value: SERVICE_FILTER_VALUE,
        label: "Servicios",
        icon: <Wrench className="w-3.5 h-3.5" />,
      },
      ...categories.map((cat) => ({
        value: cat.id,
        label: cat.name,
      })),
    ],
    [categories],
  );
  const customers = useMemo(
    () => customersData?.data ?? [],
    [customersData?.data],
  );
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(query) ||
        (customer.documentNumber ?? "").toLowerCase().includes(query),
    );
  }, [customers, customerSearch]);
  const totalPages = Math.max(productsData?.meta?.totalPages ?? 1, 1);
  const totalProducts = productsData?.meta?.total ?? 0;
  const products = useMemo(
    () => productsData?.data ?? [],
    [productsData?.data],
  );
  const visibleCurrentPage = useMemo(
    () => Math.max(1, Math.min(currentPage, totalPages)),
    [currentPage, totalPages],
  );

  useEffect(() => {
    if (!productsFailed && !isFetching && !isPlaceholderData && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages, isFetching, isPlaceholderData, productsFailed]);

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    },
    [totalPages],
  );

  const isScannerBlocked =
    showCustomerModal ||
    showReceiptModal ||
    showPaymentModal ||
    !!editingDiscount ||
    showPausedSalesModal ||
    showDeletePausedModal;

  const focusScannerInput = useCallback(() => {
    if (typeof window === "undefined") return;
    const scheduleFocus =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);

    scheduleFocus(() => {
      scannerInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    safeSetItem(FAVORITE_PRODUCTS_KEY, JSON.stringify(favoriteProductIds));
  }, [favoriteProductIds]);

  useEffect(() => {
    if (isScannerBlocked) return;
    focusScannerInput();
  }, [isScannerBlocked, focusScannerInput]);

  // Warm the lazily loaded modal chunks once idle (S1 code splitting).
  useEffect(
    () => prefetchOnIdle([loadPaymentConfirmationModal, loadMobileCartDrawer]),
    [],
  );

  // The server applies favorites/type/availability before paging and counting.
  const visibleProducts = products;

  const addToCart = useCallback((product: Product, quantity: number = 1) => {
    if (cartLockedRef.current) return;
    if (effectiveStock(product) <= 0) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        // Cap at available stock — silently ignore if already at max
        if (existing.quantity >= effectiveStock(product)) return prev;
        const newQty = Math.min(
          existing.quantity + quantity,
          effectiveStock(product),
        );
        const discountAmount = existing.discountPercent
          ? Math.min(
              (existing.unitPrice * newQty * existing.discountPercent) / 100,
              existing.unitPrice * newQty,
            )
          : Math.min(existing.discountAmount, existing.unitPrice * newQty);
        return prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: newQty, discountAmount }
            : item,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          product,
          quantity: Math.min(quantity, effectiveStock(product)),
          // Promotional price wins when present; list price stays snapshotted
          // as originalUnitPrice so the cart can strike it through. Prices are
          // normalized to numbers because salePrice can arrive as a Decimal
          // string over HTTP while effectiveSalePrice is a number.
          unitPrice: Number(product.effectiveSalePrice ?? product.salePrice),
          originalUnitPrice: Number(product.salePrice),
          discountAmount: 0,
          availableStock: effectiveStock(product),
        },
      ];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    if (cartLockedRef.current) return;
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  }, []);

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (cartLockedRef.current) return;
      if (quantity <= 0) {
        removeFromCart(productId);
        return;
      }
      setCart((prev) =>
        prev.map((item) => {
          if (item.productId !== productId) return item;
          // Cap quantity at available stock
          const newQty = Math.min(quantity, item.availableStock);
          // Recalculate discount: if percentage-based, scale with new quantity
          const itemSubtotal = item.unitPrice * newQty;
          const discountAmount = item.discountPercent
            ? Math.min(
                (itemSubtotal * item.discountPercent) / 100,
                itemSubtotal,
              )
            : Math.min(item.discountAmount, itemSubtotal);
          return { ...item, quantity: newQty, discountAmount };
        }),
      );
    },
    [removeFromCart],
  );

  /** Apply a fixed-amount discount (clears any percentage tracking) */
  const updateItemDiscount = useCallback(
    (productId: string, discountAmount: number) => {
      if (cartLockedRef.current) return;
      setCart((prev) =>
        prev.map((item) => {
          if (item.productId !== productId) return item;
          const maxDiscount = item.unitPrice * item.quantity;
          return {
            ...item,
            discountAmount: Math.min(Math.max(0, discountAmount), maxDiscount),
            discountPercent: undefined,
          };
        }),
      );
      setEditingDiscount(null);
      setCustomDiscount("");
      if (openedFromMobileCart) {
        setIsMobileCartOpen(true);
        setOpenedFromMobileCart(false);
      }
    },
    [openedFromMobileCart],
  );

  /** Apply a percentage discount that scales with quantity changes */
  const updateItemDiscountPercent = useCallback(
    (productId: string, percent: number) => {
      if (cartLockedRef.current) return;
      setCart((prev) =>
        prev.map((item) => {
          if (item.productId !== productId) return item;
          const itemSubtotal = item.unitPrice * item.quantity;
          const computed = Math.min(
            (itemSubtotal * percent) / 100,
            itemSubtotal,
          );
          return {
            ...item,
            discountPercent: percent,
            discountAmount: Math.max(0, computed),
          };
        }),
      );
      setEditingDiscount(null);
      setCustomDiscount("");
      if (openedFromMobileCart) {
        setIsMobileCartOpen(true);
        setOpenedFromMobileCart(false);
      }
    },
    [openedFromMobileCart],
  );

  /** Override a cart line's unit price, preserving any existing discount */
  const updateItemPrice = useCallback(
    (productId: string, price: number) => {
      if (cartLockedRef.current) return;
      setCart((prev) =>
        prev.map((item) => {
          if (item.productId !== productId) return item;
          const newPrice = Math.max(0, price);
          const itemSubtotal = newPrice * item.quantity;
          // Percentage discounts recompute against the new price; fixed
          // amounts stay but clamp so the line total never goes negative.
          const discountAmount = item.discountPercent
            ? Math.min(
                (itemSubtotal * item.discountPercent) / 100,
                itemSubtotal,
              )
            : Math.min(item.discountAmount, itemSubtotal);
          return {
            ...item,
            unitPrice: newPrice,
            discountAmount: Math.max(0, discountAmount),
          };
        }),
      );
      setEditingDiscount(null);
      setCustomDiscount("");
      setCustomPrice("");
      if (openedFromMobileCart) {
        setIsMobileCartOpen(true);
        setOpenedFromMobileCart(false);
      }
    },
    [openedFromMobileCart],
  );

  const openDiscountModal = useCallback(
    (productId: string) => {
      const item = cart.find((i) => i.productId === productId);
      setEditingDiscount(productId);
      setCustomDiscount("");
      setCustomPrice(item ? String(item.unitPrice) : "");
    },
    [cart],
  );

  const handleCloseDiscountModal = useCallback(() => {
    setEditingDiscount(null);
    setCustomDiscount("");
    setCustomPrice("");
    if (openedFromMobileCart) {
      setIsMobileCartOpen(true);
      setOpenedFromMobileCart(false);
    }
  }, [openedFromMobileCart]);

  const handleScanSubmit = useCallback(async () => {
    if (isScannerBlocked) {
      return;
    }

    const normalizedCode = searchQuery.trim();

    if (!normalizedCode) {
      setScanFeedback({
        tone: "warning",
        message: "Escanea o ingresa un código para buscar un producto.",
      });
      focusScannerInput();
      return;
    }

    try {
      const product = await quickSearchProduct.mutateAsync(normalizedCode);

      if (!product) {
        // Only surface the "not found" error when the value actually looks
        // like a compact barcode/SKU. Free-text browse queries keep the grid
        // filtered by the debounced contains search, with neutral feedback, so
        // typing the start of a name never interrupts browsing.
        if (isCompactCode(normalizedCode)) {
          setScanFeedback({
            tone: "error",
            message: "No encontramos un producto con ese código.",
          });
          clearSearchInput();
        } else {
          setScanFeedback(DEFAULT_SCAN_FEEDBACK);
        }
        return;
      }

      if (effectiveStock(product) <= 0) {
        setScanFeedback({
          tone: "warning",
          message: `${product.name} no tiene stock disponible.`,
        });
        clearSearchInput();
        return;
      }

      const existingItem = cart.find((item) => item.productId === product.id);
      if (existingItem && existingItem.quantity >= effectiveStock(product)) {
        setScanFeedback({
          tone: "warning",
          message: `${product.name} ya alcanzó el stock máximo en el carrito.`,
        });
        clearSearchInput();
        return;
      }

      addToCart(product);
      setScanFeedback({
        tone: "success",
        message: `${product.name} agregado al carrito.`,
      });
      clearSearchInput();
    } catch (error) {
      setScanFeedback({
        tone: "error",
        message: getApiErrorMessage(
          error,
          "No se pudo procesar el código escaneado.",
        ),
      });
      clearSearchInput();
    } finally {
      focusScannerInput();
    }
  }, [
    addToCart,
    cart,
    clearSearchInput,
    focusScannerInput,
    isScannerBlocked,
    quickSearchProduct,
    searchQuery,
  ]);

  const handleScannerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      void handleScanSubmit();
    },
    [handleScanSubmit],
  );

  const subtotal = cart.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice - item.discountAmount,
    0,
  );
  const taxAmount = cart.reduce(
    (sum, item) =>
      sum +
      (item.quantity * item.unitPrice - item.discountAmount) *
        ((item.product.effectiveTaxRate ?? item.product.taxRate) / 100),
    0,
  );
  const total = subtotal + taxAmount - discountAmount;

  const toggleFavoriteProduct = useCallback((productId: string) => {
    setFavoriteProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }, []);

  const handleCheckout = async () => {
    if (cartLockedRef.current) return;
    if (cart.length === 0) return;
    const totalPaid = paymentMethods.reduce(
      (sum, method) => sum + method.amount,
      0,
    );
    if (totalPaid < total) {
      toast.error("El monto total pagado debe cubrir el total de la venta");
      return;
    }
    if (paymentMethods.length === 0) {
      toast.error("Debes seleccionar al menos un metodo de pago");
      return;
    }
    try {
      const result = await createSale.mutateAsync({
        customerId: selectedCustomer || undefined,
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          // Sent only for a real override. For every other line the server
          // derives the price itself, so a promotion applied after the line
          // entered the cart is honoured instead of being read as an
          // (unauthorized) override request.
          ...(cartItemPriceOverride(item)
            ? { unitPrice: item.unitPrice }
            : {}),
          discountAmount: item.discountAmount,
        })),
        discountAmount,
        payments: paymentMethods.map((method) => ({
          method: method.type,
          amount: method.amount,
        })),
      });
      setLastSale(result);
      setCart([]);
      setDiscountAmount(0);
      setAmountPaid(undefined);
      setSelectedCustomer("");
      setSearchQuery("");
      setDebouncedSearch("");
      setCurrentPage(1);
      setPaymentMethods([]);
      setShowPaymentModal(false);
      setShowReceiptModal(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al realizar la venta"));
    }
  };

  /**
   * The financing request for the current cart. One builder feeds both the
   * request and its identity, so a payload change can never leave the pinned
   * request key describing a different request.
   */
  const buildFinanceRequest = () => ({
    customerId: selectedCustomer,
    reason: "Venta financiada",
    discountAmount,
    items: cart.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      // Sent only for a real override, exactly like the checkout path.
      ...(cartItemPriceOverride(item) ? { unitPrice: item.unitPrice } : {}),
      discountAmount: item.discountAmount,
    })),
  });
  // The live payload identity: an in-flight response is compared against the
  // current payload, never against the closure that started the request.
  const financeSignatureRef = useRef("");
  financeSignatureRef.current = JSON.stringify(buildFinanceRequest());

  /**
   * Initiate a financed POS sale for the current cart. The server returns the
   * agreed customer total, which is what the UI surfaces — never the
   * client-computed cart total. A failed attempt leaves the cart, customer and
   * discount untouched and retries with the same pinned requestKey. A success
   * only claims and clears the payload it financed.
   */
  const handleFinanceSale = async () => {
    // Single flight: a second confirmation must not start another initiation.
    if (financingRef.current || cartLockedRef.current) return;
    if (cart.length === 0 || !selectedCustomer) return;
    financingRef.current = true;
    setFinancing(true);
    const request = buildFinanceRequest();
    const signature = JSON.stringify(request);
    const attempt =
      posLoanAttemptRef.current?.signature === signature
        ? posLoanAttemptRef.current
        : { key: crypto.randomUUID(), signature };
    posLoanAttemptRef.current = attempt;
    try {
      const result = await createPosLoan.mutateAsync({
        ...request,
        requestKey: attempt.key,
      });
      const financedTotal = formatCurrency(
        Number(result.agreedCustomerTotal),
      );
      if (posLoanAttemptRef.current === attempt) posLoanAttemptRef.current = null;
      if (financeSignatureRef.current !== signature) {
        // The financed payload is no longer the sale on screen: report the
        // financing instead of claiming its amount for a different cart.
        toast.success(`Venta financiada por ${financedTotal}`);
        setOpenedFromMobileCart(false);
        financeCompletedRef.current = true;
        return;
      }
      setCart([]);
      setDiscountAmount(0);
      setSelectedCustomer("");
      setOpenedFromMobileCart(false);
      financeCompletedRef.current = true;
      toast.success(
        `Venta financiada por ${financedTotal}. Puedes verla en Préstamos.`,
      );
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, "Error al iniciar la venta financiada"),
      );
    } finally {
      financingRef.current = false;
      setFinancing(false);
    }
  };

  const handlePrintReceipt = async () => {
    if (lastSale) {
      try {
        await printReceipt(lastSale.id);
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "Error al imprimir el comprobante"),
        );
      }
    }
  };

  const handlePrintThermalReceipt = () => {
    if (lastSale) {
      printThermalReceipt(lastSale, settings?.organization?.name ?? "Mi Negocio", {
        logoUrl: settings?.organization?.logoUrl,
        header: settings?.invoicing?.printHeader,
        footer: settings?.invoicing?.printFooter,
      });
    }
  };

  const handlePauseSale = () => {
    if (cart.length === 0) {
      toast.info("No hay productos en el carrito");
      return;
    }
    try {
      const customerName = selectedCustomer
        ? customers.find((c) => c.id === selectedCustomer)?.name
        : "Cliente General";
      pauseSale(cart, selectedCustomer, discountAmount, customerName);
      setCart([]);
      setDiscountAmount(0);
      setAmountPaid(undefined);
      setSelectedCustomer("");
      setSearchQuery("");
      setDebouncedSearch("");
      setCurrentPage(1);
      setPaymentMethods([]);
      setEditingDiscount(null);
      setCustomDiscount("");
      toast.success("Venta pausada correctamente");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al pausar la venta",
      );
    }
  };

  const handleResumeSale = async (saleId: string) => {
    if (cartLockedRef.current) return;
    try {
      const resumedSale = resumeSale(saleId);
      // Re-derive each line's price from the product's CURRENT state so a
      // promo changed/removed while the sale sat paused reprices before
      // checkout (stale rebates shrink to the new unit price instead of
      // going negative). Mirrors the availableStock backfill precedent.
      const freshProducts = await Promise.all(
        resumedSale.cart.map((item) =>
          api
            .get<Product>(`/products/${item.productId}`)
            .then((res) => res.data)
            .catch(() => item.product),
        ),
      );
      const repricedCart = resumedSale.cart.map((item, index) => {
        const freshProduct = freshProducts[index] ?? item.product;
        const unitPrice = freshProduct.effectiveSalePrice ?? freshProduct.salePrice;
        return {
          ...item,
          product: freshProduct,
          availableStock: effectiveStock(freshProduct),
          unitPrice,
          originalUnitPrice: freshProduct.salePrice,
          discountAmount: Math.min(
            Math.max(0, item.discountAmount),
            unitPrice * item.quantity,
          ),
        };
      });
      setCart(repricedCart);
      setSelectedCustomer(resumedSale.customerId);
      setDiscountAmount(resumedSale.discountAmount);
      setShowPausedSalesModal(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al reanudar la venta",
      );
    }
  };

  const handleDeletePausedSale = (saleId: string) => {
    setPausedSaleToDelete(saleId);
    setShowDeletePausedModal(true);
  };

  const confirmDeletePausedSale = () => {
    if (!pausedSaleToDelete) return;
    deletePausedSale(pausedSaleToDelete);
    toast.success("Venta pausada eliminada");
    setPausedSaleToDelete(null);
  };

  const openPaymentModal = () => {
    setPaymentMethods([
      {
        type: selectedPaymentMethod,
        amount: selectedPaymentMethod === "CASH" ? (amountPaid ?? 0) : total,
      },
    ]);
    setShowPaymentModal(true);
  };

  const selectedCustomerName = selectedCustomer
    ? customers.find((c) => c.id === selectedCustomer)?.name
    : null;

  return (
    <DashboardLayout>
      <div className={cn("flex flex-col gap-4 lg:grid lg:h-[calc(100dvh-6rem)] lg:min-h-[500px] lg:grid-cols-12 lg:gap-4", cart.length > 0 && "pb-28 lg:pb-0")}>
        {/* Products Panel */}
        <div className="flex min-h-0 flex-col lg:col-span-7 lg:h-full">
          <div className="flex h-[calc(100dvh-8rem)] min-h-[580px] flex-col rounded-2xl border border-border/70 bg-card sm:min-h-[500px] lg:h-full">
            {/* Products Header */}
            <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Productos
              </h2>
              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {cart.length} en carrito
                  </span>
                )}
              </div>
            </div>

            {/* Unified search & scanner — types to filter the grid, Enter scans/adds */}
            <div className="flex shrink-0 flex-col gap-2 p-4 border-b border-border/60 bg-muted/15">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    ref={scannerInputRef}
                    placeholder="Escanear o buscar por nombre, SKU o código..."
                    value={searchQuery}
                    onChange={(e) => {
                      handleSearchChange(e.target.value);
                      if (scanFeedback.message) {
                        setScanFeedback(DEFAULT_SCAN_FEEDBACK);
                      }
                    }}
                    onKeyDown={handleScannerKeyDown}
                    disabled={isScannerBlocked || quickSearchProduct.isPending}
                    className="pl-9 h-[38px] rounded-lg text-sm"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  aria-pressed={showFavoritesOnly}
                  size="md"
                  onClick={() => {
                    setShowFavoritesOnly((c) => !c);
                    setCurrentPage(1);
                  }}
                  className={cn(
                    "shrink-0 rounded-lg",
                    showFavoritesOnly &&
                      "border-emerald-600/50 dark:border-emerald-500/50 bg-emerald-500/[0.08] dark:bg-emerald-500/[0.10] text-foreground hover:border-emerald-600/60 dark:hover:border-emerald-500/60 hover:bg-emerald-500/[0.12] hover:text-foreground",
                  )}
                >
                  <Star
                    className={cn(
                      "w-3.5 h-3.5",
                      showFavoritesOnly && "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400",
                    )}
                  />
                  Favoritos
                </Button>
                <BentoSelect
                  value={selectedFilter}
                  onChange={(value) => {
                    setSelectedFilter(value);
                    setCurrentPage(1);
                  }}
                  className="w-full sm:w-48 shrink-0"
                  placeholder="Todas las categorías"
                  options={filterOptions}
                />
              </div>
              {scanFeedback.message && (
                <p
                  role="status"
                  className={cn(
                    "text-xs font-medium",
                    {
                      idle: "text-muted-foreground",
                      success: "text-emerald-600 dark:text-emerald-400",
                      warning: "text-amber-600 dark:text-amber-400",
                      error: "text-red-600 dark:text-red-400",
                    }[scanFeedback.tone],
                  )}
                >
                  {scanFeedback.message}
                </p>
              )}
            </div>

            {/* Product Grid */}
            <div ref={capacityAreaRef} data-testid="pos-capacity-area" className="min-h-[280px] flex-1 p-4">
              <div
                ref={productGridRef}
                style={{ gridTemplateColumns: POS_GRID_TEMPLATE_COLUMNS }}
                className={cn(
                  "grid h-full auto-rows-[248px] grid-rows-[repeat(auto-fill,minmax(248px,1fr))] gap-3 transition-opacity duration-150 [&>div]:aspect-auto [&>div]:h-full [&>div]:min-h-0 [&>div]:max-h-none",
                  isFetching && !searching ? "opacity-60" : "opacity-100",
                )}
              >
                {productsFailed ? (
                  <ErrorState
                    className="col-span-full"
                    message={getApiErrorMessage(productsError, "No se pudieron cargar los productos.")}
                    retryLabel="Reintentar"
                    onRetry={() => void refetchProducts()}
                  />
                ) : searching || isPlaceholderData ? (
                  <LoadingState icon={<Package className="w-4 h-4 text-muted-foreground" />} message="Buscando productos..." />
                ) : visibleProducts.length > 0 ? (
                  visibleProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      mode="pos"
                      product={product}
                      onClick={() => addToCart(product as Product)}
                      isFavorite={favoriteProductIds.includes(product.id)}
                      onToggleFavorite={() => toggleFavoriteProduct(product.id)}
                    />
                  ))
                ) : (
                  <EmptyState
                    icon={<Package className="w-6 h-6 text-muted-foreground/30" />}
                    title={
                      showFavoritesOnly
                        ? "No tienes favoritos"
                        : debouncedSearch
                          ? "No se encontraron productos"
                          : totalProducts > 0
                            ? "No hay productos en esta pagina"
                            : "No hay productos disponibles"
                    }
                  />
                )}
              </div>

            </div>

            {/* Always reserve the pager area so counts cannot resize the grid. */}
            <div data-testid="pos-pager" className="flex min-h-[64px] shrink-0 items-center border-t border-border/60 px-4 py-2.5">
              {totalPages > 1 && (
                <div className="w-full">
                  <Pagination
                    className="[&>div]:flex-wrap [&>div]:justify-center"
                    currentPage={visibleCurrentPage}
                    totalPages={totalPages}
                    onPageChange={goToPage}
                    totalItems={totalProducts}
                    pageSize={pageSize}
                    itemLabel="producto"
                    isDisabled={isFetching}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Cart Panel (Desktop) */}
        <div className="hidden lg:flex min-h-0 lg:col-span-5 lg:h-full flex-col">
          <div className="h-auto min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-card lg:h-full flex flex-col">
            {/* Cart Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Carrito
              </h2>
              {cart.length > 0 && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {cart.length}
                </span>
              )}
            </div>

            {/* Cart Items */}
            <div className="scrollbar-app max-h-[55vh] overflow-y-auto p-4 space-y-2.5 lg:flex-1 lg:min-h-0 lg:max-h-none">
              {cart.length === 0 ? (
                <EmptyState icon={<ShoppingCart className="w-6 h-6 text-muted-foreground/30" />} title="Carrito vacío" subtitle="Agrega productos para comenzar" />
              ) : (
                cart.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-stretch gap-3.5 p-3 bg-muted/20 rounded-xl border border-border/60 hover:border-border transition-colors duration-150"
                  >
                    <div className="relative w-20 self-stretch min-h-[4.5rem] bg-muted/60 border border-border/50 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                      {item.product.imageUrl ? (
                        <Image
                          src={item.product.imageUrl}
                          alt={item.product.name}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : (
                        <Package className="w-6 h-6 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground line-clamp-1 mb-1">
                        {item.product.name}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground tabular-nums mb-2">
                        {cartItemOffer(item) && (
                          <Badge
                            variant="danger"
                            className="shrink-0 text-[11px] px-1.5 py-0.5 font-mono uppercase rounded-md"
                          >
                            Oferta -{cartItemOffer(item)!.percent}%
                          </Badge>
                        )}
                        {cartItemPriceOverride(item) && (
                          <span data-testid="price-overridden" className="shrink-0">
                            <Badge
                              variant="warning"
                              className="text-[11px] px-1.5 py-0.5 font-mono uppercase rounded-md"
                            >
                              Precio ajustado
                            </Badge>
                          </span>
                        )}
                        {Number.isFinite(Number(item.originalUnitPrice)) &&
                          Number(item.unitPrice) !==
                            Number(item.originalUnitPrice) && (
                            <s
                              data-testid="original-unit-price"
                              className="text-muted-foreground/60 line-through"
                            >
                              {formatCurrency(Number(item.originalUnitPrice))}
                            </s>
                          )}
                        <span data-testid="line-unit-price">
                          {formatCurrency(item.unitPrice)}
                        </span>{" "}
                        × {item.quantity}
                        {item.discountAmount > 0 && (
                          <span
                            data-testid="line-discount"
                            className="ml-1.5 text-emerald-600 dark:text-emerald-400"
                          >
                            (-{formatCurrency(item.discountAmount)}
                            {item.discountPercent
                              ? ` · ${item.discountPercent}%`
                              : ""}
                            )
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2">
                        <Stepper
                          value={item.quantity}
                          min={0}
                          max={item.availableStock}
                          size="sm"
                          onChange={(value) =>
                            updateQuantity(item.productId, value)
                          }
                        />
                        {item.quantity >= item.availableStock && (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            máx.
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => openDiscountModal(item.productId)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors duration-150"
                          title="Descuento"
                        >
                          <Percent className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.productId)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors duration-150"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-center">
                      <span className="stat-number text-base font-semibold text-foreground tabular-nums">
                        {formatCurrency(
                          item.quantity * item.unitPrice - item.discountAmount,
                        )}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/10 space-y-3 shrink-0">
              {/* Customer Selector */}
              <div>
                <p className="text-[13px] font-normal text-muted-foreground mb-1.5">
                  Cliente (opcional)
                </p>
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(true)}
                  className="flex items-center gap-2.5 w-full h-9 px-3 rounded-lg border border-border/70 bg-background/60 text-sm text-foreground hover:border-border transition-colors duration-150 overflow-hidden"
                >
                  <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate text-[13px] font-medium">
                    {selectedCustomerName || "Sin cliente"}
                  </span>
                </button>
              </div>

              {/* Financed sale: quiet secondary action, far from the checkout button */}
              <button
                type="button"
                onClick={() => setShowFinanceConfirm(true)}
                disabled={cart.length === 0 || !selectedCustomer || cartLocked}
                title={
                  !selectedCustomer
                    ? "Selecciona un cliente para financiar"
                    : undefined
                }
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <HandCoins className="w-3.5 h-3.5" />
                Financiar a crédito
              </button>

              {/* Totals Breakdown */}
              <div className="rounded-lg bg-muted/25 px-3.5 py-2.5 border border-border/60">
                {discountAmount > 0 && (
                  <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 mb-1.5 pb-1.5 border-b border-border/40 tabular-nums">
                    <span>Descuento</span>
                    <span className="font-medium">
                      -{formatCurrency(discountAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-[13px] font-medium text-muted-foreground">
                    Total
                  </span>
                  <span className="stat-number text-xl font-semibold tracking-tight text-primary-text tabular-nums">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>

              {/* Pause / Resume */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowPausedSalesModal(true)}
                  className="flex-1 h-9 rounded-lg text-xs font-medium"
                >
                  <Play className="w-3.5 h-3.5" />
                  Reanudar ({pausedSales.length})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePauseSale}
                  disabled={cart.length === 0}
                  className="flex-1 h-9 rounded-lg text-xs font-medium"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pausar
                </Button>
              </div>

              {/* Payment Method Cards */}
              <PaymentMethodCards
                selectedMethod={selectedPaymentMethod}
                onMethodChange={setSelectedPaymentMethod}
              />

              {/* Checkout */}
              <Button
                className="w-full h-10 rounded-lg text-sm font-semibold"
                size="lg"
                onClick={openPaymentModal}
                disabled={cart.length === 0 || cartLocked}
                loading={createSale.isPending}
              >
                <ShoppingCart className="w-4 h-4 mr-1.5" />
                Finalizar Venta
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Cart Floating Bar */}
      <MobileCartFloatingBar
        cart={cart}
        total={total}
        onClick={() => setIsMobileCartOpen(true)}
      />

      {/* Mobile Cart Drawer (dynamic chunk, mounted only while open) */}
      {isMobileCartOpen && (
        <MobileCartDrawer
          isOpen={isMobileCartOpen}
          onClose={() => setIsMobileCartOpen(false)}
          cart={cart}
          subtotal={subtotal}
          taxAmount={taxAmount}
          discountAmount={discountAmount}
          total={total}
          selectedCustomerName={selectedCustomerName}
          onOpenCustomerModal={() => {
            setOpenedFromMobileCart(true);
            setIsMobileCartOpen(false);
            setShowCustomerModal(true);
          }}
          pausedSalesCount={pausedSales.length}
          onOpenPausedSales={() => {
            setOpenedFromMobileCart(true);
            setIsMobileCartOpen(false);
            setShowPausedSalesModal(true);
          }}
          onPauseSale={handlePauseSale}
          selectedPaymentMethod={selectedPaymentMethod}
          onPaymentMethodChange={(method) => setSelectedPaymentMethod(method)}
          onUpdateQuantity={updateQuantity}
          onOpenDiscountModal={(productId) => {
            setOpenedFromMobileCart(true);
            setIsMobileCartOpen(false);
            openDiscountModal(productId);
          }}
          onRemoveFromCart={removeFromCart}
          onCheckout={() => {
            setIsMobileCartOpen(false);
            openPaymentModal();
          }}
          onFinance={() => {
            setOpenedFromMobileCart(true);
            setIsMobileCartOpen(false);
            setShowFinanceConfirm(true);
          }}
          canFinance={Boolean(selectedCustomer) && !cartLocked}
          isFinancing={createPosLoan.isPending}
          isPending={createSale.isPending}
        />
      )}

      {/* Customer Modal */}
      <Modal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false);
          setCustomerSearch("");
          if (openedFromMobileCart) {
            setIsMobileCartOpen(true);
            setOpenedFromMobileCart(false);
          }
        }}
        title="Seleccionar Cliente"
        size="md"
      >
        <div className="space-y-3">
          <SearchField
            value={customerSearch}
            onChange={setCustomerSearch}
            placeholder="Buscar cliente por nombre o documento..."
            inputClassName="h-9 text-sm"
          />
          <div className="scrollbar-app max-h-[26rem] overflow-y-auto space-y-1.5 pr-1">
            <div
              className={cn(
                "flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg cursor-pointer transition-colors duration-150 border",
                selectedCustomer === ""
                  ? "border-emerald-600/50 dark:border-emerald-500/50 bg-emerald-500/[0.08] dark:bg-emerald-500/[0.10] text-foreground"
                  : "border-border/70 bg-muted/20 dark:bg-background/40 hover:border-foreground/25 hover:bg-muted/50",
              )}
              onClick={() => {
                if (cartLockedRef.current) return;
                setSelectedCustomer("");
                setShowCustomerModal(false);
                setCustomerSearch("");
                if (openedFromMobileCart) {
                  setIsMobileCartOpen(true);
                  setOpenedFromMobileCart(false);
                }
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  Cliente General
                </p>
                {selectedCustomer === "" && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400"
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground shrink-0">
                Sin cliente asignado
              </p>
            </div>
            {filteredCustomers.map((customer) => {
              const isSelected = selectedCustomer === customer.id;
              return (
                <div
                  key={customer.id}
                  className={cn(
                    "flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg cursor-pointer transition-colors duration-150 border",
                    isSelected
                      ? "border-emerald-600/50 dark:border-emerald-500/50 bg-emerald-500/[0.08] dark:bg-emerald-500/[0.10] text-foreground"
                      : "border-border/70 bg-muted/20 dark:bg-background/40 hover:border-foreground/25 hover:bg-muted/50",
                  )}
                  onClick={() => {
                    if (cartLockedRef.current) return;
                    setSelectedCustomer(customer.id);
                    setShowCustomerModal(false);
                    setCustomerSearch("");
                    if (openedFromMobileCart) {
                      setIsMobileCartOpen(true);
                      setOpenedFromMobileCart(false);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {customer.name}
                    </p>
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400"
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                    {customer.documentNumber}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {showPaymentModal && (
        <PaymentConfirmationModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          onConfirm={handleCheckout}
          cart={cart}
          subtotal={subtotal}
          taxAmount={taxAmount}
          total={total}
          selectedMethod={selectedPaymentMethod}
          paymentMethods={paymentMethods}
          onPaymentMethodChange={setPaymentMethods}
          loading={createSale.isPending}
          customerName={
            selectedCustomer
              ? customers.find((c) => c.id === selectedCustomer)?.name
              : "Cliente General"
          }
          saleNumber={lastSale?.saleNumber}
        />
      )}

      {/* Receipt Success Modal */}
      {lastSale && (
        <Modal
          isOpen={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          title="¡Venta Completada!"
          size="lg"
        >
          <div className="space-y-5">
            <div
              className="text-center py-5 rounded-xl border"
              style={{
                backgroundColor: "rgba(16,185,129,0.06)",
                borderColor: "rgba(16,185,129,0.2)",
              }}
            >
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500 flex items-center justify-center">
                <Printer className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-1">
                Venta Exitosa
              </h3>
              <p className="text-sm text-muted-foreground font-mono">
                Comprobante #{lastSale.saleNumber}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Cliente",
                  value: lastSale.customer?.name || "Cliente General",
                },
                {
                  label: "Método",
                  value:
                    (lastSale.payments?.length ?? 0) > 1
                      ? "Mixto"
                      : lastSale.payments?.[0]?.method === "CASH"
                        ? "Efectivo"
                        : lastSale.payments?.[0]?.method === "CARD"
                          ? "Tarjeta"
                          : "Transferencia",
                },
                {
                  label: "Items",
                  value: `${lastSale.items.length} producto(s)`,
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="p-3 rounded-2xl bg-background/40 border border-accent/20"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {label}
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {value}
                  </p>
                </div>
              ))}
              <div className="p-3 rounded-2xl bg-primary/10 border border-primary/30">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Total
                </p>
                <p className="stat-number text-lg font-bold text-primary-text">
                  {formatCurrency(lastSale.total)}
                </p>
              </div>
            </div>

            {lastSale.amountPaid != null && lastSale.amountPaid > 0 ? (
              <div className="p-3 rounded-2xl bg-background/40 border border-accent/20 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pagado:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(lastSale.amountPaid)}
                  </span>
                </div>
                {lastSale.change !== null ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Cambio:</span>
                    <span className="stat-number font-bold text-accent">
                      {formatCurrency(lastSale.change)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col sm:flex-row gap-3 justify-end pt-2 border-t border-primary/20">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowReceiptModal(false);
                  setLastSale(null);
                }}
                className="sm:w-auto"
              >
                Cerrar
              </Button>
              <Button variant="secondary" onClick={handlePrintReceipt}>
                <FileDown className="w-4 h-4" /> Descargar PDF
              </Button>
              <Button onClick={handlePrintThermalReceipt}>
                <Printer className="w-4 h-4" /> Imprimir Recibo Térmico
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Discount Modal */}
      {editingDiscount && (
        <Modal
          isOpen={!!editingDiscount}
          onClose={handleCloseDiscountModal}
          title="Agregar Descuento"
          size="sm"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              {canOverridePrice && (
                <>
                  <CurrencyInput
                    label="Precio unitario"
                    value={customPrice}
                    onChange={(value) => setCustomPrice(value === 0 ? "" : String(value))}
                    placeholder="Precio"
                  />
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={!customPrice}
                    onClick={() => {
                      if (!editingDiscount) return;
                      const price = Number(customPrice);
                      if (Number.isNaN(price) || price < 0) return;
                      updateItemPrice(editingDiscount, price);
                    }}
                  >
                    Aplicar precio
                  </Button>
                </>
              )}
            </div>

            <CurrencyInput
              label="Monto del descuento"
              value={customDiscount}
              onChange={(value) => setCustomDiscount(value === 0 ? "" : String(value))}
              placeholder="0.00"
            />
            <div className="flex gap-2">
              {[10, 20, 50].map((pct) => (
                <Button
                  key={pct}
                  variant="secondary"
                  onClick={() => {
                    if (editingDiscount)
                      updateItemDiscountPercent(editingDiscount, pct);
                  }}
                  className="flex-1"
                >
                  {pct}%
                </Button>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={handleCloseDiscountModal}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (editingDiscount)
                    updateItemDiscount(editingDiscount, Number(customDiscount));
                }}
                className="flex-1"
                disabled={!customDiscount}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Paused Sales Modal */}
      <Modal
        isOpen={showPausedSalesModal}
        onClose={() => {
          setShowPausedSalesModal(false);
          if (openedFromMobileCart) {
            setIsMobileCartOpen(true);
            setOpenedFromMobileCart(false);
          }
        }}
        title="Ventas Pausadas"
        size="xl"
      >
        <div className="space-y-3">
          {pausedSales.length === 0 ? (
            <EmptyState
              icon={<Pause className="h-12 w-12" />}
              title="No hay ventas pausadas"
              subtitle="Pausa una venta para que aparezca aquí"
            />
          ) : (
            <div className="scrollbar-app max-h-96 overflow-y-auto space-y-2.5">
              {pausedSales.map((sale) => (
                <div
                  key={sale.id}
                  className="p-4 rounded-xl bg-background/40 border border-border/70"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {sale.customerName || "Cliente General"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {sale.cart.length} producto(s) ·{" "}
                        {new Date(sale.pausedAt).toLocaleString("es-CO")}
                      </p>
                    </div>
                    <span className="stat-number text-base font-bold text-primary-text">
                      {formatCurrency(
                        sale.cart.reduce(
                          (sum, item) =>
                            sum +
                            item.quantity * item.unitPrice -
                            item.discountAmount,
                          0,
                        ),
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleResumeSale(sale.id)}
                      className="flex-1"
                    >
                      <Play className="w-3.5 h-3.5" /> Reanudar
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDeletePausedSale(sale.id)}
                      className="p-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showFinanceConfirm}
        onClose={() => {
          // A pending initiation must not be abandoned: the request is already
          // on its way and the debt may exist without the cart that started it.
          if (financingRef.current) return;
          setShowFinanceConfirm(false);
          if (financeCompletedRef.current) {
            financeCompletedRef.current = false;
            return;
          }
          if (openedFromMobileCart) {
            setIsMobileCartOpen(true);
            setOpenedFromMobileCart(false);
          }
        }}
        onConfirm={handleFinanceSale}
        title="Confirmar venta financiada"
        message={`Se iniciará una venta financiada a nombre de ${
          selectedCustomerName ?? "el cliente seleccionado"
        }. Monto a financiar: ${formatCurrency(total)} (calculado en el POS; el total final lo confirma el servidor).`}
        confirmText="Financiar venta"
      />

      <ConfirmDialog
        isOpen={showDeletePausedModal}
        onClose={() => {
          setShowDeletePausedModal(false);
          setPausedSaleToDelete(null);
        }}
        onConfirm={confirmDeletePausedSale}
        title="Eliminar venta pausada"
        message="Se eliminará la venta pausada de forma definitiva."
        confirmText="Eliminar"
      />
    </DashboardLayout>
  );
}
