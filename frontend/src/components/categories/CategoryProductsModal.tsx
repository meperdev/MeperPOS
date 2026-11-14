"use client";

import Image from "next/image";
import { useLayoutEffect, useRef, useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { Modal } from "@/components/ui/Modal";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatCurrency } from "@/lib/utils";
import { isService } from "@/lib/product-type";
import { Package, PackageX } from "lucide-react";
import type { Category, Product } from "@/types";

interface CategoryProductsModalProps {
  category: Category | null;
  onClose: () => void;
}

function StockBadge({ product }: { product: Product }) {
  // A service carries no stock chip and is never out of stock nor low on stock,
  // whatever the stored numbers say. The low-stock decision is the server's
  // (`isLowStock`), so an untracked product cannot be badged from stale numbers.
  const service = isService(product);
  const isOutOfStock = !service && product.stock === 0;
  const isLowStock = product.isLowStock === true;

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-md font-mono text-[11px] font-semibold border tabular-nums shrink-0",
        service
          ? "bg-muted/60 text-muted-foreground border-border/60"
          : isOutOfStock
            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
            : isLowStock
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
      )}
    >
      {service ? "Servicio" : `${product.stock} uds.`}
    </span>
  );
}

function ProductRow({ product }: { product: Product }) {
  const isInactive = product.active === false;

  return (
    <li
      className={cn(
        "grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-border",
        isInactive && "opacity-60",
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="48px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-5 w-5 text-muted-foreground/30" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="[overflow-wrap:anywhere] text-[13px] font-semibold text-foreground leading-snug">
          {product.name}
        </p>
        <div className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
          <span className="font-mono text-[11px] font-medium text-muted-foreground">
            {product.sku}
          </span>
          {isInactive && (
            <span className="font-mono text-[11px] font-semibold text-muted-foreground">
              · Inactivo
            </span>
          )}
        </div>
      </div>

      {/* Price + stock */}
      <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-border/50 [overflow-wrap:anywhere]">
        <span className="font-mono text-[13px] font-semibold text-foreground tabular-nums">
          {formatCurrency(product.salePrice)}
        </span>
        <StockBadge product={product} />
      </div>
    </li>
  );
}

// The budget excludes modal header, padding, count, footer and their gaps.
// Use the tallest measured card so wrapped text never relies on a fixed height.
export function categoryPageCapacity(budget: number, width: number, rowHeight: number) {
  const columns = width >= 640 ? 2 : 1;
  const rows = Math.max(1, Math.floor((budget + 8) / (Math.max(116, rowHeight) + 8)));
  return rows * columns;
}

function CategoryPage({ category, onClose }: { category: Category; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [geometry, setGeometry] = useState(() => ({
    height: typeof window === "undefined" ? 600 : window.innerHeight,
    width: typeof window === "undefined" ? 320 : Math.min(896, window.innerWidth) - 80,
    chrome: 240,
    rowHeight: 116,
  }));
  const limit = categoryPageCapacity(geometry.height - geometry.chrome, geometry.width, geometry.rowHeight);
  const [paging, setPaging] = useState({ limit, page: 1 });
  // Adjust during render: never send the old page with a newly calculated limit.
  const page = paging.limit === limit ? paging.page : 1;
  if (paging.limit !== limit) setPaging({ limit, page: 1 });

  const { data, isLoading, isError, isPlaceholderData } = useProducts({
    categoryId: category.id, page, limit, status: "all",
  });
  // The shared hook keeps previous query data; it is not this request's result.
  const current = !isPlaceholderData && !isError ? data : undefined;
  const products = current?.data ?? [];
  const total = current?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const clamping = !!current && page > totalPages;
  if (clamping) setPaging({ limit, page: totalPages });
  const pending = isLoading || isPlaceholderData || clamping;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const content = body.parentElement!;
    const header = content.previousElementSibling;
    const measure = () => {
      const width = body.getBoundingClientRect().width || Math.min(896, window.innerWidth) - 80;
      const style = getComputedStyle(content);
      const padding = (parseFloat(style.paddingTop) || 24) + (parseFloat(style.paddingBottom) || 24);
      const measuredChrome = (header?.getBoundingClientRect().height || 64)
        + (countRef.current?.getBoundingClientRect().height || 28)
        + (pagerRef.current?.getBoundingClientRect().height || 64)
        + padding + (window.innerWidth >= 640 ? 32 : 16) + 26;
      const measuredRow = Math.max(116, ...Array.from(listRef.current?.children ?? []).map(row => row.getBoundingClientRect().height));
      const height = window.visualViewport?.height ?? window.innerHeight;
      setGeometry(previous => {
        // Keep a high-water mark per width to prevent page-size oscillation.
        const rowHeight = width === previous.width ? Math.max(previous.rowHeight, measuredRow) : measuredRow;
        const chrome = width === previous.width ? Math.max(previous.chrome, measuredChrome) : measuredChrome;
        if (previous.width === width && previous.height === height && previous.chrome === chrome && previous.rowHeight === rowHeight) return previous;
        return { width, height, chrome, rowHeight };
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    [body, header, countRef.current, pagerRef.current, listRef.current].forEach(node => { if (node) observer?.observe(node); });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [data, isPlaceholderData]);

  const start = products.length ? (page - 1) * limit + 1 : 0;
  const end = products.length ? Math.min(total, (page - 1) * limit + products.length) : 0;
  return (
    <Modal isOpen onClose={onClose} title={`Productos · ${category.name}`} size="lg" scrollContent={false}>
      <div ref={bodyRef} className="flex min-w-0 flex-col gap-3">
        <div ref={countRef} className="inline-flex w-fit items-center rounded-md border border-border/60 bg-muted/50 px-2.5 py-0.5 font-mono text-xs font-medium text-muted-foreground tabular-nums" aria-live="polite">
          {current && !clamping ? `${total} ${total === 1 ? "producto" : "productos"}` : "Productos"}
        </div>
        {pending ? (
          <LoadingState className="min-h-0 py-2" icon={<Package className="w-4 h-4 text-muted-foreground" />} message="Cargando productos..." />
        ) : isError ? (
          <EmptyState className="min-h-0 py-2" icon={<PackageX className="w-5 h-5 text-muted-foreground" />} title="No se pudieron cargar los productos" subtitle="Intenta de nuevo más tarde" />
        ) : products.length === 0 ? (
          <EmptyState className="min-h-0 py-2" icon={<PackageX className="w-5 h-5 text-muted-foreground" />} title="No hay productos en esta categoría" subtitle={total === 0 ? "Aún no se han asignado productos" : undefined} />
        ) : (
          <ul ref={listRef} className={cn("grid items-start gap-2.5", geometry.width >= 640 ? "grid-cols-2" : "grid-cols-1")}>
            {products.map(product => <ProductRow key={product.id} product={product} />)}
          </ul>
        )}
        <nav ref={pagerRef} aria-label="Paginación de productos" className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border/60 pt-3 text-xs">
          <span aria-live="polite" className="mr-auto font-mono text-[11px] text-muted-foreground tabular-nums">
            {current && !clamping ? `Mostrando ${start}–${end} de ${total}` : "Esperando productos"}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Página anterior" disabled={pending || isError || page === 1} onClick={() => setPaging({ limit, page: page - 1 })} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none">Anterior</button>
            <span aria-live="polite" className="px-1 font-mono text-xs font-medium text-muted-foreground tabular-nums">Página {page}{current && !clamping ? ` de ${totalPages}` : ""}</span>
            <button type="button" aria-label="Página siguiente" disabled={pending || isError || !current || page >= totalPages} onClick={() => setPaging({ limit, page: page + 1 })} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none">Siguiente</button>
          </div>
        </nav>
      </div>
    </Modal>
  );
}

export function CategoryProductsModal({ category, onClose }: CategoryProductsModalProps) {
  // Changing category or closing unmounts the local page and geometry state.
  return category ? <CategoryPage key={category.id} category={category} onClose={onClose} /> : null;
}
