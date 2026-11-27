"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useProducts, useQuickSearchProduct } from "@/hooks/useProducts";
import { useCategories } from "@/hooks/useCategories";
import { useCustomers } from "@/hooks/useCustomers";
import { useCreateSale } from "@/hooks/useSales";
import { useCreatePosLoan } from "@/hooks/useLoans";
import { usePausedSales } from "@/hooks/usePausedSales";
import {
  downloadReceiptPdf,
  openReceiptPdf,
} from "@/hooks/useReceipt";
import { Input } from "@/components/ui/Input";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { DynamicFallback } from "@/components/ui/DynamicFallback";
import { prefetchOnIdle } from "@/lib/prefetch";
import { shouldAutoFocusTextInput } from "@/lib/input-focus";
import { useCartUndo } from "@/hooks/useCartUndo";
import dynamic from "next/dynamic";
import { PaymentMethodCards } from "@/components/pos/PaymentMethodCards";
import { PausedSalesModal } from "@/components/pos/PausedSalesModal";
import { CartLine } from "@/components/pos/CartLine";
import { DiscountModal } from "@/components/pos/DiscountModal";
import { MobileCartFloatingBar } from "@/components/pos/MobileCartFloatingBar";
import { ProductCard } from "@/components/products/ProductCard";
import {
  Search,
  Star,
  ShoppingCart,
  Printer,
  FileDown,
  Package,
  Pause,
  Play,
  User,
  Wrench,
  HandCoins,
  Store,
  ArrowLeftRight,
} from "lucide-react";
import { cn, formatCurrency, safeGetItem, safeSetItem } from "@/lib/utils";
import { toCheckoutCents } from "@/lib/pos-checkout-money";
import { haptic } from "@/lib/haptics";
import { effectiveStock } from "@/lib/product-type";
import type { CartItem, Product, Sale } from "@/types";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { hasAnyRole } from "@/lib/auth";
import { api, getApiErrorMessage } from "@/lib/api";
import {
  guardOrganizationScopeChange,
  readOrganizationScope,
} from "@/lib/organizationScope";
import { usePosOrganizationScope } from "@/hooks/usePosSiteContext";
import { PosSiteGate, type PosCheckoutSite } from "./PosSiteGate";

import { useMediaQuery } from "@/hooks/useEffectiveViewMode";
import {
  observePOSGrid,
  POS_GRID_ROW_CLASSES,
  POS_PHONE_QUERY,
  posGridTemplateColumns,
} from "./pos-layout";

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

/**
 * One add, applied purely: every way the cart can absorb a tap — append a new
 * line, raise an existing one, or refuse it because the stock is gone or the
 * line already holds all of it — decided in one place.
 *
 * It returns `changed` alongside the cart because the answer decides two things
 * that must never disagree: the state, and the tap haptic (S4.2). A refused add
 * buzzes like a success if the caller has to re-derive the outcome itself.
 */
function addCartLine(
  cart: CartItem[],
  product: Product,
  quantity: number,
): { cart: CartItem[]; changed: boolean } {
  const stock = effectiveStock(product);
  if (stock <= 0) return { cart, changed: false };

  const existing = cart.find((item) => item.productId === product.id);
  if (existing) {
    // Cap at available stock — silently ignore if already at max
    if (existing.quantity >= stock) return { cart, changed: false };
    const newQty = Math.min(existing.quantity + quantity, stock);
    const discountAmount = existing.discountPercent
      ? Math.min(
          (existing.unitPrice * newQty * existing.discountPercent) / 100,
          existing.unitPrice * newQty,
        )
      : Math.min(existing.discountAmount, existing.unitPrice * newQty);
    return {
      cart: cart.map((item) =>
        item.productId === product.id
          ? { ...item, quantity: newQty, discountAmount }
          : item,
      ),
      changed: true,
    };
  }

  return {
    cart: [
      ...cart,
      {
        productId: product.id,
        product,
        quantity: Math.min(quantity, stock),
        // Promotional price wins when present; list price stays snapshotted
        // as originalUnitPrice so the cart can strike it through. Prices are
        // normalized to numbers because salePrice can arrive as a Decimal
        // string over HTTP while effectiveSalePrice is a number.
        unitPrice: Number(product.effectiveSalePrice ?? product.salePrice),
        originalUnitPrice: Number(product.salePrice),
        discountAmount: 0,
        availableStock: stock,
      },
    ],
    changed: true,
  };
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
  const { user, loading } = useAuth();
  const adminOrganization = usePosOrganizationScope(
    Boolean(user?.isSuperAdmin),
  );
  const organizationId = user?.isSuperAdmin
    ? adminOrganization
    : user?.organizationId;

  return (
    <DashboardLayout>
      {!loading &&
        user &&
        (organizationId ? (
          <PosSiteGate
            key={JSON.stringify([user.id, organizationId])}
            userId={user.id}
            organizationId={organizationId}
          >
            {(site, scope) => (
              <POSWorkspace
                key={scope}
                scope={scope}
                site={site}
                organizationId={organizationId}
              />
            )}
          </PosSiteGate>
        ) : (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Selecciona una organización para usar el punto de venta.
          </p>
        ))}
    </DashboardLayout>
  );
}

function POSWorkspace({
  scope,
  site,
  organizationId,
}: {
  scope: string;
  site: PosCheckoutSite;
  organizationId: string;
}) {
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The site the gate verified for this workspace: the catalogue, the search
  // and the scanner read its balance instead of the organization aggregate.
  const activeSiteId = site.id;

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
    if (authLoading || !site.available) return;
    const area = capacityAreaRef.current;
    const grid = productGridRef.current;
    if (!area || !grid) return;
    return observePOSGrid(area, grid, (capacity) => {
      if (capacityRef.current === capacity) return;
      capacityRef.current = capacity;
      setPageSize(capacity);
      setCurrentPage(1);
    });
  }, [authLoading, site.available]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  // A scanner focus the page asked for and has not delivered yet: on a hard
  // load the shell can render the page before its grid exists.
  const scannerFocusPendingRef = useRef(false);
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
  const [showPausedSalesModal, setShowPausedSalesModal] = useState(false);
  // Financing is the only action here that creates a real debt, so it waits for
  // an explicit confirmation before the initiation request is built or sent.
  const [showFinanceConfirm, setShowFinanceConfirm] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(
    DEFAULT_SCAN_FEEDBACK,
  );
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [openedFromMobileCart, setOpenedFromMobileCart] = useState(false);
  // The phone grid is a dense tile wall; wider viewports keep the measured
  // geometry. A viewport that cannot be measured keeps the desktop layout.
  const isPhoneViewport = useMediaQuery(POS_PHONE_QUERY, false);

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
    locationId: activeSiteId,
  });
  const { data: categoriesData } = useCategories({ limit: 100 });
  const { data: customersData } = useCustomers();
  const { pausedSales, pauseSale, getPausedSale, deletePausedSale } =
    usePausedSales(scope);
  const resumingRef = useRef(false);
  const scopeUserId = user?.id;
  const posScope = useMemo(
    () =>
      scopeUserId ? { userId: scopeUserId, organizationId } : undefined,
    [scopeUserId, organizationId],
  );
  const createSale = useCreateSale(posScope, activeSiteId);
  const [checkingOut, setCheckingOut] = useState(false);
  const checkingOutRef = useRef(false);
  const createPosLoan = useCreatePosLoan(posScope, activeSiteId);
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
  const cartLocked = !site.available || checkingOut || financing || createPosLoan.isPending;
  // A financing in flight owns the payload it will report back: while it is
  // pending nothing may edit the cart, the customer or the discount, or the
  // financed lines could be sold or financed a second time.
  const cartLockedRef = useRef(cartLocked);
  cartLockedRef.current = cartLocked;
  // The lock a cart mutation must answer against. The rendered state alone
  // leaves one event's gap between "checkout took the cart" and the first
  // re-render, so the refs set synchronously at the entry points are part of
  // the same answer.
  const cartIsLocked = () =>
    cartLockedRef.current || checkingOutRef.current || financingRef.current;
  // Same reason as `cartLockedRef`: `addToCart` has to answer "did this change
  // anything?" before React has re-rendered, and the answer decides whether the
  // phone buzzes (S4.2). The mirror is synced in an effect to keep the render
  // pure; `addToCart` advances it by hand so two taps in one tick still compose.
  const cartRef = useRef<CartItem[]>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);
  const hasActiveCart = cart.length > 0;
  useLayoutEffect(() => {
    if (!hasActiveCart) return;
    return guardOrganizationScopeChange(() => {
      toast.info(
        "Termina, pausa o vacía el carrito antes de cambiar de organización",
      );
      return false;
    });
  }, [hasActiveCart, toast]);

  const scopeIsCurrent = () =>
    mounted.current &&
    (!user?.isSuperAdmin || readOrganizationScope() === organizationId);

  const verifySiteForPayment = async () => {
    if (!scopeIsCurrent()) return false;
    const eligible = await site.revalidate();
    if (!scopeIsCurrent()) return false;
    if (!eligible) toast.error("El cobro no está habilitado para esta sede");
    return eligible;
  };
  const posLoanAttemptRef = useRef<{ key: string; signature: string } | null>(
    null,
  );
  // The ordinary checkout pins its idempotency key the same way: the key
  // belongs to the exact request body it was minted for, so a retry of that same
  // body after a lost response replays instead of selling twice, while any edit
  // to the cart, customer, discount or payment split mints a new one. A success
  // clears it so a second, deliberate sale never reuses the key.
  const checkoutAttemptRef = useRef<{ key: string; signature: string } | null>(
    null,
  );
  const quickSearchProduct = useQuickSearchProduct({
    locationId: activeSiteId,
  });

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
    showPausedSalesModal;

  const focusScannerInput = useCallback(() => {
    if (typeof window === "undefined") return;
    const scheduleFocus =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0);

    scheduleFocus(() => {
      const field = scannerInputRef.current;
      // Absent or still disabled: the request stays pending and the field
      // claims it when it attaches (see registerScannerInput).
      if (!field || field.disabled) return;
      scannerFocusPendingRef.current = false;
      field.focus();
    });
  }, []);

  /**
   * Mirrors the scanner field and delivers a focus the page asked for.
   *
   * A hard load renders the page inside the layout shell, so the effect that
   * hands the scanner its focus can run a frame before the grid — and the field
   * — exists. The request stays pending across that gap and lands here instead
   * of being lost.
   *
   * `Input` re-attaches its DOM ref on every render, so this runs often. The
   * pending request is answered once, and only while the app may take the focus
   * by itself: a pointer that can type, a field that is not disabled by an open
   * dialog, and nothing else focused. Any other focus belongs to the reader.
   */
  const registerScannerInput = useCallback(
    (field: HTMLInputElement | HTMLTextAreaElement | null) => {
      const input = field instanceof HTMLInputElement ? field : null;
      scannerInputRef.current = input;
      if (!input || input.disabled || !scannerFocusPendingRef.current) return;
      if (!shouldAutoFocusTextInput()) {
        scannerFocusPendingRef.current = false;
        return;
      }
      const active = typeof document === "undefined" ? null : document.activeElement;
      if (active && active !== document.body && active !== input) return;
      scannerFocusPendingRef.current = false;
      input.focus();
    },
    [],
  );

  // Arms the page-ready focus: it lands now when the field is mounted, or when
  // the field attaches if the grid is still missing.
  const requestScannerFocus = useCallback(() => {
    scannerFocusPendingRef.current = true;
    focusScannerInput();
  }, [focusScannerInput]);

  useEffect(() => {
    safeSetItem(FAVORITE_PRODUCTS_KEY, JSON.stringify(favoriteProductIds));
  }, [favoriteProductIds]);

  useEffect(() => {
    if (isScannerBlocked) return;
    // The scanner field is where a barcode reader types, so a desktop POS hands
    // it the focus as soon as the page is ready. On a phone that focus opens the
    // software keyboard over the grid, so the page never does it by itself.
    if (!shouldAutoFocusTextInput()) return;
    requestScannerFocus();
  }, [isScannerBlocked, requestScannerFocus]);

  // Warm the lazily loaded modal chunks once idle (S1 code splitting).
  useEffect(
    () => prefetchOnIdle([loadPaymentConfirmationModal, loadMobileCartDrawer]),
    [],
  );

  // The server applies favorites/type/availability before paging and counting.
  const visibleProducts = products;

  const addToCart = useCallback((product: Product, quantity: number = 1) => {
    if (cartIsLocked()) return;

    // Every add the POS offers — the product tile and the scanner — comes
    // through here, so this is the one place a tap can buzz. The buzz answers
    // "the line moved": a locked cart, a product out of stock or a line already
    // holding all the stock is refused silently, in the cart and in the hand.
    const decision = addCartLine(cartRef.current, product, quantity);
    if (!decision.changed) return;

    // Advance the mirror by hand so two taps in one tick compose instead of
    // both reading the cart from before the first render. The functional
    // updater stays the authority for the state: a stale mirror could then
    // mistime a buzz, never drop a line.
    cartRef.current = decision.cart;
    setCart((prev) => addCartLine(prev, product, quantity).cart);
    haptic("tap");
  }, []);

  // Every removal is reversible for a few seconds: a stray tap on "−" or on the
  // bin during a sale is cheap to undo and expensive to lose.
  const cartUndo = useCartUndo(cart, setCart, {
    isLocked: () => cartIsLocked(),
  });
  const removeFromCart = cartUndo.removeLine;

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (cartIsLocked()) return;
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
      if (cartIsLocked()) return;
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
      if (cartIsLocked()) return;
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
      if (cartIsLocked()) return;
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
      if (openedFromMobileCart) {
        setIsMobileCartOpen(true);
        setOpenedFromMobileCart(false);
      }
    },
    [openedFromMobileCart],
  );

  const openDiscountModal = useCallback((productId: string) => {
    setEditingDiscount(productId);
  }, []);

  const handleCloseDiscountModal = useCallback(() => {
    setEditingDiscount(null);
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

  // Line bases before tax, each already net of its per-item discount.
  const lineGrossBases = cart.map(
    (item) => item.quantity * item.unitPrice - item.discountAmount,
  );
  const subtotal = lineGrossBases.reduce((sum, gross) => sum + gross, 0);

  // Server parity (SEC-015): the sale-wide discount reduces each line's
  // taxable base proportionally BEFORE tax, mirroring the
  // allocateSaleDiscount() split the backend applies. The last line
  // absorbs the rounding remainder so the shares always add up, and the
  // discount is clamped to the gross subtotal like the server does.
  const clampedSaleDiscount = Math.min(
    Math.max(discountAmount, 0),
    Math.max(subtotal, 0),
  );
  const sharesExceptLast = lineGrossBases.slice(0, -1).map((gross) =>
    subtotal > 0 ? (gross * clampedSaleDiscount) / subtotal : 0,
  );
  const lastShare =
    clampedSaleDiscount -
    sharesExceptLast.reduce((sum, share) => sum + share, 0);
  const discountShares = [...sharesExceptLast, lastShare];

  // Match toPersistedLineTax: round each line's tax, not the sum of raw taxes.
  const taxCents = cart.reduce((sum, item, index) => {
    const rate = item.product.effectiveTaxRate ?? item.product.taxRate;
    const lineTax = (lineGrossBases[index] - discountShares[index]) * (rate / 100);
    return sum + Math.round(lineTax * 100);
  }, 0);
  const taxAmount = taxCents / 100;
  // Like SalesService, charge from the stored (cent-precision) subtotal.
  const storedSubtotal = toCheckoutCents(subtotal) / 100;
  const totalCents = toCheckoutCents(storedSubtotal - clampedSaleDiscount) + taxCents;
  const total = totalCents / 100;

  const toggleFavoriteProduct = useCallback((productId: string) => {
    setFavoriteProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }, []);

  const handleCheckout = async () => {
    if (checkingOutRef.current || financingRef.current || cartLockedRef.current) return;
    if (cart.length === 0) return;
    const paidCents = paymentMethods.reduce(
      (sum, method) => sum + toCheckoutCents(method.amount),
      0,
    );
    if (paidCents < totalCents) {
      toast.error("El monto total pagado debe cubrir el total de la venta");
      return;
    }
    if (paymentMethods.length === 0) {
      toast.error("Debes seleccionar al menos un metodo de pago");
      return;
    }
    // Mirrors `SalesService.create` (S3 / D1). The server is the authority and
    // rejects these splits anyway; answering here turns a 400 into the sentence
    // that tells the cashier what to fix. Change is only ever cash, and on a
    // positive total no tender may be surplus on its own.
    const overpaidCents = paidCents - totalCents;
    if (overpaidCents > 0 && !paymentMethods.some((method) => method.type === "CASH")) {
      toast.error("Las tarjetas y transferencias no dan cambio");
      return;
    }
    if (
      overpaidCents > 0 &&
      paymentMethods.some((method) =>
        totalCents > 0
          ? toCheckoutCents(method.amount) <= overpaidCents
          : method.type !== "CASH",
      )
    ) {
      toast.error("Sobra un pago: con los demás métodos ya se cubre el total");
      return;
    }
    checkingOutRef.current = true;
    setCheckingOut(true);
    // Freeze the payload the cashier confirmed before the preflight is awaited:
    // the sale that leaves must describe this cart, this customer and these
    // tenders, never a later state that changed while it waited. One builder
    // feeds both the request and its identity, so a payload change can never
    // leave the pinned request key describing a different request.
    const request = {
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
    };
    const signature = JSON.stringify(request);
    // SEC-014: a retry of this exact body reuses its key so the server replays
    // the sale it already persisted; anything else is a new intent.
    const attempt =
      checkoutAttemptRef.current?.signature === signature
        ? checkoutAttemptRef.current
        : { key: crypto.randomUUID(), signature };
    checkoutAttemptRef.current = attempt;
    try {
      if (!(await verifySiteForPayment())) return;
      // The intent that survived the preflight must still be the live one: an
      // unmounted workspace or a superseded checkout must not charge.
      if (!checkingOutRef.current || !scopeIsCurrent()) return;
      const result = await createSale.mutateAsync({
        ...request,
        requestKey: attempt.key,
      });
      if (checkoutAttemptRef.current === attempt) checkoutAttemptRef.current = null;
      if (!scopeIsCurrent()) return;
      setLastSale(result);
      setCart([]);
      // A finished or paused sale must not leave an undo offer pointing at it.
      cartUndo.clearUndo();
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
      if (scopeIsCurrent()) {
        toast.error(getApiErrorMessage(error, "Error al realizar la venta"));
      }
    } finally {
      checkingOutRef.current = false;
      if (mounted.current) setCheckingOut(false);
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
    if (financingRef.current || checkingOutRef.current || cartLockedRef.current) return;
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
      if (!(await verifySiteForPayment())) return;
      const result = await createPosLoan.mutateAsync({
        ...request,
        requestKey: attempt.key,
      });
      if (!scopeIsCurrent()) return;
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
      // A finished or paused sale must not leave an undo offer pointing at it.
      cartUndo.clearUndo();
      setDiscountAmount(0);
      setSelectedCustomer("");
      setOpenedFromMobileCart(false);
      financeCompletedRef.current = true;
      toast.success(
        `Venta financiada por ${financedTotal}. Puedes verla en Préstamos.`,
      );
    } catch (error) {
      if (scopeIsCurrent()) {
        toast.error(
          getApiErrorMessage(error, "Error al iniciar la venta financiada"),
        );
      }
    } finally {
      financingRef.current = false;
      if (mounted.current) setFinancing(false);
    }
  };

  const handleDownloadReceipt = async () => {
    if (lastSale) {
      try {
        await downloadReceiptPdf(lastSale.id);
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "Error al descargar el comprobante"),
        );
      }
    }
  };

  const handleOpenReceipt = async () => {
    if (lastSale) {
      try {
        await openReceiptPdf(lastSale.id);
      } catch (error) {
        toast.error(
          getApiErrorMessage(error, "Error al abrir el comprobante"),
        );
      }
    }
  };

  const handlePauseSale = () => {
    // A validation or submission in flight owns this cart: pausing it now would
    // leave the same lines both resumable later and charged by the running sale.
    if (cartIsLocked()) return;
    if (cart.length === 0) {
      toast.info("No hay productos en el carrito");
      return;
    }
    try {
      const customerName = selectedCustomer
        ? customers.find((c) => c.id === selectedCustomer)?.name
        : "Sin cliente";
      pauseSale(cart, selectedCustomer, discountAmount, customerName);
      setCart([]);
      // A finished or paused sale must not leave an undo offer pointing at it.
      cartUndo.clearUndo();
      setDiscountAmount(0);
      setAmountPaid(undefined);
      setSelectedCustomer("");
      setSearchQuery("");
      setDebouncedSearch("");
      setCurrentPage(1);
      setPaymentMethods([]);
      setEditingDiscount(null);
      toast.success("Venta pausada correctamente");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al pausar la venta",
      );
    }
  };

  const handleResumeSale = async (saleId: string) => {
    if (resumingRef.current || cartIsLocked()) return;
    resumingRef.current = true;
    try {
      const resumedSale = getPausedSale(saleId);
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
      if (!scopeIsCurrent() || cartIsLocked()) return;
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
      // The source draft leaves its scope only once the awaited cart has been
      // restored here; an interrupted resume must keep the original draft.
      deletePausedSale(saleId);
    } catch (error) {
      if (scopeIsCurrent()) {
        toast.error(
          error instanceof Error ? error.message : "Error al reanudar la venta",
        );
      }
    } finally {
      resumingRef.current = false;
    }
  };

  const handleDeletePausedSale = (saleId: string) => {
    deletePausedSale(saleId);
    toast.success("Venta pausada eliminada");
  };

  const openPaymentModal = () => {
    // The mobile drawer's checkout lands here too, so the lock is taken at the
    // entry point rather than only on the desktop button.
    if (cartIsLocked()) return;
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

  if (!site.available) return null;

  return (
    <>
      <h1 className="sr-only">Punto de venta</h1>
      {/* At lg this page fits the viewport exactly. The height subtracts the two
          things the shell owns — the header bar and the vertical padding it
          actually applies — so the root measures the space the browser gives it
          instead of guessing. The negative vertical margin reclaims half of that
          padding: the till is a work surface, so its own gutter is 16px top and
          bottom while it still ends 16px above the viewport edge (no page
          scroll, no leftover band under the products panel). */}
      <div data-testid="pos-page-root" className={cn("flex flex-col gap-4 h-[var(--mobile-content-height)] lg:h-[calc(100dvh-var(--app-header-height)-var(--app-content-padding-y))] lg:-my-[calc(var(--app-content-padding-y)/2)] lg:min-h-[500px] lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)] lg:gap-4", cart.length > 0 && "pb-28 lg:pb-0")}>
        {/* Products Panel */}
        <div className="flex min-h-0 flex-1 flex-col lg:h-full">
          {/*
            Below lg the panel fills the shell's content box exactly — the space
            between the fixed top bar and the tab bar (L3: the document scrolls,
            so a panel that guessed its own `dvh` offset pushed a second
            scrollbar onto the page). `lg:h-full` keeps the desktop split.
          */}
          <div
            data-testid="pos-products-panel"
            className="flex h-full min-h-0 flex-col rounded-2xl border border-border/70 bg-card max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent"
          >
            {/* Products Header — desktop only: on a phone the top bar already says
                POS and the floating cart bar already carries the count. */}
            <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-border/60 max-lg:hidden">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Productos
              </h2>
              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {cart.length} en carrito
                  </span>
                )}
              </div>
            </div>

            {/* Unified search & scanner — types to filter the grid, Enter scans/adds */}
            <div className="@container flex shrink-0 flex-col gap-2 p-4 border-b border-border/60 bg-muted/15 max-lg:px-0 max-lg:bg-transparent">
              {/* The active store is the context of every price, stock figure and
                  sale on this screen, so it reads as a control, not a footnote. */}
              <div className="flex flex-wrap items-center gap-2">
                {site.change ? (
                  <button
                    type="button"
                    onClick={site.change}
                    disabled={cart.length > 0 || cartLocked}
                    className={cn(
                      "inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-card px-3 text-[13px] shadow-xs transition-colors",
                      "hover:border-primary/40 hover:bg-primary-light/40",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border/70 disabled:hover:bg-card",
                    )}
                  >
                    <Store className="h-4 w-4 shrink-0 text-primary-text" aria-hidden="true" />
                    <span className="truncate font-semibold text-foreground">{site.name}</span>
                    <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary-text">
                      <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Cambiar sede
                    </span>
                  </button>
                ) : (
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 text-[13px]">
                    <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-semibold text-foreground">{site.name}</span>
                  </span>
                )}
                {site.change && cart.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Pausa o termina la venta para cambiar de sede
                  </span>
                )}
              </div>
              {/* Intrinsic wrap, like FilterBar: Favoritos and the category select share a row under the search when narrow. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[14rem] flex-[999_1_16rem]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    ref={registerScannerInput}
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
                    className="pl-9 h-10 sm:h-9 rounded-lg text-sm"
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
                      "border-success/30 bg-success/10 text-foreground hover:border-success/40 hover:bg-success/15 hover:text-foreground",
                  )}
                >
                  <Star
                    className={cn(
                      "w-3.5 h-3.5",
                      showFavoritesOnly && "fill-warning text-warning-text",
                    )}
                  />
                  Favoritos
                </Button>
                <Select
                  value={selectedFilter}
                  onChange={(value) => {
                    setSelectedFilter(value);
                    setCurrentPage(1);
                  }}
                  // "Todas las categorías" needs 138px of text plus the trigger's
                  // own padding and chevron: below 200px the label clipped. The
                  // floor only applies from xl, where the panel is wide enough to
                  // pay for it without starving the search field.
                  className="min-w-0 flex-[1_1_10rem] xl:min-w-[12.5rem]"
                  placeholder="Todas las categorías"
                  options={filterOptions}
                />
              </div>
              {scanFeedback.message && (
                <p
                  role="status"
                  className={cn(
                    "text-[13px] font-medium",
                    {
                      idle: "text-muted-foreground",
                      success: "text-success-text",
                      warning: "text-warning-text",
                      error: "text-danger-text",
                    }[scanFeedback.tone],
                  )}
                >
                  {scanFeedback.message}
                </p>
              )}
            </div>

            {/* Product Grid */}
            {/* Below lg the panel is exactly the shell's content box, so this area scrolls and the pager stays put. */}
            <div ref={capacityAreaRef} data-testid="pos-capacity-area" className="min-h-0 flex-1 overflow-y-auto p-4 max-lg:px-0 lg:overflow-visible">
              <div
                ref={productGridRef}
                style={{ gridTemplateColumns: posGridTemplateColumns(isPhoneViewport) }}
                className={cn(
                  "grid",
                  POS_GRID_ROW_CLASSES,
                  "transition-opacity duration-150",
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
                            ? "No hay productos en esta página"
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
                    pinned={false}
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
        <div className="hidden lg:flex min-h-0 lg:h-full flex-col">
          <div className="@container h-auto min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-card lg:h-full flex flex-col">
            {/* Cart Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  Carrito
                </h2>
                {cart.length > 0 && (
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {cart.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowPausedSalesModal(true)}
                  className="h-8 px-2.5 text-xs font-medium tabular-nums"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  Reanudar ({pausedSales.length})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePauseSale}
                  disabled={cart.length === 0 || cartLocked}
                  className="h-8 px-2.5 text-xs font-medium"
                >
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  Pausar
                </Button>
              </div>
            </div>

            {/* Cart Items */}
            <div className="scrollbar-app max-h-[55vh] overflow-y-auto p-4 space-y-2 lg:flex-1 lg:min-h-0 lg:max-h-none">
              {cart.length === 0 ? (
                <EmptyState icon={<ShoppingCart className="w-6 h-6 text-muted-foreground/30" />} title="Carrito vacío" subtitle="Agrega productos para comenzar" />
              ) : (
                cart.map((item) => (
                  <CartLine
                    key={item.productId}
                    item={item}
                    onQuantityChange={updateQuantity}
                    onDiscount={openDiscountModal}
                    onRemove={removeFromCart}
                  />
                ))
              )}
            </div>

            {/* Cart Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/10 space-y-3 shrink-0">
              {/* Customer and financed sale share one compact horizontal utility row. */}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(true)}
                  title={selectedCustomerName || undefined}
                  className={cn(
                    "flex h-9 min-w-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    selectedCustomer
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border/80 bg-muted/20 dark:bg-background/50 text-muted-foreground hover:border-foreground/25 hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className={cn("shrink-0", selectedCustomer ? "text-primary-text" : "text-muted-foreground")}>
                    <User className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 truncate tracking-tight">
                    {selectedCustomerName || "Sin cliente"}
                  </span>
                </button>

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
                  className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/80 px-3 text-[13px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  <span className="shrink-0">
                    <HandCoins className="w-4 h-4" />
                  </span>
                  <span className="tracking-tight whitespace-nowrap">
                    Financiar
                  </span>
                </button>
              </div>

              {/* Payment Method Segmented Control */}
              <PaymentMethodCards
                selectedMethod={selectedPaymentMethod}
                onMethodChange={setSelectedPaymentMethod}
              />

              {/* Totals Breakdown */}
              <div className="rounded-lg bg-muted/25 px-3.5 py-2.5 border border-border/60">
                {discountAmount > 0 && (
                  <div className="flex justify-between text-[13px] text-success-text mb-1.5 pb-1.5 border-b border-border/40 tabular-nums">
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
                  <span
                    data-testid="pos-cart-total"
                    className="stat-number text-xl font-semibold tracking-tight text-primary-text tabular-nums"
                  >
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>

              {/* Checkout */}
              <Button
                className="w-full h-10 rounded-lg text-sm font-semibold"
                size="lg"
                onClick={openPaymentModal}
                disabled={cart.length === 0 || cartLocked}
                loading={checkingOut || createSale.isPending}
              >
                <ShoppingCart className="w-4 h-4 mr-1.5" />
                Finalizar venta
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
          isPending={checkingOut || createSale.isPending}
        />
      )}

      {/*
        Undo bar. Sits above the mobile floating bar and inside the safe area,
        because the whole point is that it is reachable with a thumb right after
        the tap that removed the line by accident.
      */}
      {cartUndo.lastRemoval && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+5.5rem)] z-[80] mx-auto flex w-[min(24rem,calc(100%-2rem))] items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-lg animate-fade-in-up lg:bottom-[calc(var(--safe-bottom)+1.5rem)]"
        >
          <span className="min-w-0 truncate text-sm text-foreground">
            {cartUndo.lastRemoval.item.product.name} eliminado
          </span>
          <button
            type="button"
            onClick={cartUndo.undoRemove}
            className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold text-primary-text transition-colors hover:bg-primary-light active:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            Deshacer
          </button>
        </div>
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
        title="Seleccionar cliente"
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
                  ? "border-success/30 bg-success/10 text-foreground"
                  : "border-border/70 bg-muted/20 dark:bg-background/40 hover:border-foreground/25 hover:bg-muted/50",
              )}
              onClick={() => {
                if (cartIsLocked()) return;
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
                  Sin cliente
                </p>
                {selectedCustomer === "" && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                  />
                )}
              </div>
              <p className="text-[13px] text-muted-foreground shrink-0">
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
                      ? "border-success/30 bg-success/10 text-foreground"
                      : "border-border/70 bg-muted/20 dark:bg-background/40 hover:border-foreground/25 hover:bg-muted/50",
                  )}
                  onClick={() => {
                    if (cartIsLocked()) return;
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
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                      />
                    )}
                  </div>
                  <p className="text-[13px] text-muted-foreground tabular-nums shrink-0">
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
          onClose={() => {
            // A validation or submission already owns this cart: dismissing the
            // dialog would hide the only surface that reports the outcome.
            if (checkingOutRef.current || createSale.isPending) return;
            setShowPaymentModal(false);
          }}
          onConfirm={handleCheckout}
          cart={cart}
          subtotal={subtotal}
          taxAmount={taxAmount}
          total={total}
          selectedMethod={selectedPaymentMethod}
          paymentMethods={paymentMethods}
          onPaymentMethodChange={setPaymentMethods}
          loading={checkingOut || createSale.isPending}
          customerName={
            selectedCustomer
              ? customers.find((c) => c.id === selectedCustomer)?.name
              : "Sin cliente"
          }
          saleNumber={lastSale?.saleNumber}
        />
      )}

      {/* Receipt Success Modal */}
      {lastSale && (
        <Modal
          isOpen={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          title="Venta registrada"
          size="lg"
        >
          <div className="space-y-5">
            <div className="text-center py-5 rounded-xl border border-success/30 bg-success/10">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-success flex items-center justify-center">
                <Printer className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                Comprobante #{lastSale.saleNumber}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Cliente",
                  value: lastSale.customer?.name || "Sin cliente",
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
                  label: "Productos",
                  value: `${lastSale.items.length} producto(s)`,
                },
              ].map(({ label, value }) => (
                <div key={label} className="p-3 rounded-lg bg-muted/40">
                  <p className="text-[13px] text-muted-foreground mb-1">
                    {label}
                  </p>
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
              <div className="p-3 rounded-lg bg-primary/10">
                <p className="text-[13px] text-muted-foreground mb-1">
                  Total
                </p>
                <p className="stat-number text-lg font-semibold tabular-nums text-primary-text">
                  {formatCurrency(lastSale.total)}
                </p>
              </div>
            </div>

            {lastSale.amountPaid != null && lastSale.amountPaid > 0 ? (
              <div className="p-3 rounded-lg bg-muted/40 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pagado:</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCurrency(lastSale.amountPaid)}
                  </span>
                </div>
                {lastSale.change !== null ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Cambio:</span>
                    <span className="stat-number font-semibold text-accent tabular-nums">
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
              <Button variant="secondary" onClick={handleDownloadReceipt}>
                <FileDown className="w-4 h-4" /> Descargar PDF
              </Button>
              <Button onClick={handleOpenReceipt}>
                <Printer className="w-4 h-4" /> Ver / imprimir
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Discount Modal */}
      {editingDiscount && (
        <DiscountModal
          isOpen
          item={cart.find((item) => item.productId === editingDiscount) ?? null}
          canOverridePrice={canOverridePrice}
          onClose={handleCloseDiscountModal}
          onApplyDiscount={updateItemDiscount}
          onApplyDiscountPercent={updateItemDiscountPercent}
          onApplyPrice={updateItemPrice}
        />
      )}

      {/* Paused Sales Modal */}
      <PausedSalesModal
        isOpen={showPausedSalesModal}
        onClose={() => {
          setShowPausedSalesModal(false);
          if (openedFromMobileCart) {
            setIsMobileCartOpen(true);
            setOpenedFromMobileCart(false);
          }
        }}
        pausedSales={pausedSales}
        onResume={handleResumeSale}
        onDelete={handleDeletePausedSale}
      />

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
    </>
  );
}
