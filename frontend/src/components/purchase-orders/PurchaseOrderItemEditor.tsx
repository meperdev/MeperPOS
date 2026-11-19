"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ClipboardList, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableHeader, TableRow, TableCell } from "@/components/ui/Table";
import { useProducts } from "@/hooks/useProducts";
import { useToast } from "@/contexts/ToastContext";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

/** One order line while it is still being edited, before it becomes a request body. */
export interface PurchaseOrderItemRow {
  tempId: string;
  productId: string;
  productName: string;
  productSku: string;
  qtyOrdered: number;
  unitCost: number;
  taxRate: number;
}

interface Props {
  rows: PurchaseOrderItemRow[];
  onChange: (rows: PurchaseOrderItemRow[]) => void;
  title?: string;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * A line without a price is not a line worth persisting: the product's catalog
 * cost can be empty (services) and the server would store a zero total. The
 * value can also arrive as a Decimal string ("12535.00"), which is still a price.
 */
export function rowWithoutCost(row: PurchaseOrderItemRow) {
  const cost = Number(row.unitCost);
  return !Number.isFinite(cost) || cost <= 0;
}

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/**
 * The one list of reasons a draft cannot be saved, so the new-order page and
 * the draft editor block on exactly the same rules.
 */
export function draftBlockingReasons({
  supplierId,
  items,
}: {
  supplierId?: string;
  items: PurchaseOrderItemRow[];
}): string[] {
  const withoutCost = items.filter(rowWithoutCost).length;
  const badQty = items.filter((item) => item.qtyOrdered < 1).length;
  const badTax = items.filter((item) => item.taxRate < 0 || item.taxRate > 100).length;

  return [
    !supplierId && "Selecciona un proveedor",
    items.length === 0 && "Agrega al menos un producto",
    withoutCost > 0 && `Completa el costo de ${count(withoutCost, "producto", "productos")}`,
    badQty > 0 && `Ajusta la cantidad de ${count(badQty, "producto", "productos")}`,
    badTax > 0 && `Revisa el IVA de ${count(badTax, "producto", "productos")}`,
  ].filter(Boolean) as string[];
}

/**
 * The one item editor for a purchase order draft: the new-order page and the
 * draft modal both mount it, so searching, aligning columns, and flagging a row
 * without a cost can never drift apart between the two flows.
 */
export function PurchaseOrderItemEditor({
  rows,
  onChange,
  title = "Productos en la orden",
}: Props) {
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const searchId = useId();
  const resultsId = `${searchId}-results`;
  const optionId = (index: number) => `${resultsId}-${index}`;

  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // The results float over the rows: a body portal keeps the card's scroll
  // container and the modal body from clipping them.
  const [placement, setPlacement] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const { data: productsData } = useProducts({
    limit: 25,
    search: term.trim() || undefined,
    status: "active",
  });
  const products = useMemo(() => productsData?.data ?? [], [productsData]);

  // A click anywhere outside the card (or the portalled results) closes them,
  // without touching the rows behind.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Anchor the portalled results to the search field, above it when the bottom
  // of the viewport is too close to show a useful list.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 280 && rect.top > spaceBelow;
      setPlacement({
        left: rect.left,
        width: rect.width,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Adding a product puts the caret where the order usually starts: its quantity.
  // Both layouts render that field; the hidden one ignores focus, so focusing
  // them in DOM order leaves the caret in whichever one is on screen.
  useEffect(() => {
    const tempId = pendingFocus.current;
    if (!tempId) return;
    pendingFocus.current = null;
    const root = rootRef.current;
    if (!root) return;
    for (const layout of ["list", "table"]) {
      root
        .querySelectorAll<HTMLInputElement>(
          `input[data-qty-layout="${layout}"][data-qty-row="${tempId}"]`,
        )
        .forEach((input) => input.focus());
    }
  }, [rows]);

  const addProduct = (product: Product) => {
    if (rows.some((row) => row.productId === product.id)) {
      toast.error("Ese producto ya está en la orden");
      return;
    }
    const tempId = genId();
    onChange([
      ...rows,
      {
        tempId,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        qtyOrdered: 1,
        unitCost: product.costPrice,
        taxRate: product.taxRate,
      },
    ]);
    pendingFocus.current = tempId;
    setTerm("");
    setOpen(false);
    setActiveIndex(0);
  };

  const updateRow = (tempId: string, patch: Partial<PurchaseOrderItemRow>) =>
    onChange(rows.map((row) => (row.tempId === tempId ? { ...row, ...patch } : row)));

  const removeRow = (tempId: string) =>
    onChange(rows.filter((row) => row.tempId !== tempId));

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(products.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      const highlighted = products[activeIndex];
      if (highlighted) {
        event.preventDefault();
        addProduct(highlighted);
      }
      return;
    }
    if (event.key === "Escape") {
      // First Escape dismisses the results, the second clears what was typed.
      event.preventDefault();
      if (open) setOpen(false);
      else if (term) setTerm("");
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  const qtyInput = (row: PurchaseOrderItemRow, layout: "table" | "list") => (
    <Input
      type="number"
      min={1}
      aria-label={`Cantidad de ${row.productName}`}
      value={row.qtyOrdered}
      onChange={(event) =>
        updateRow(row.tempId, { qtyOrdered: Number(event.target.value) || 0 })
      }
      className="text-right"
      data-qty-layout={layout}
      data-qty-row={row.tempId}
    />
  );

  const costInput = (row: PurchaseOrderItemRow, layout: "table" | "list") => {
    const missing = rowWithoutCost(row);
    const inputId = `${layout}-${row.tempId}-cost`;
    return (
      <div>
        <label htmlFor={inputId} className="sr-only">
          Costo unitario de {row.productName}
        </label>
        <CurrencyInput
          id={inputId}
          value={row.unitCost}
          onChange={(value) => updateRow(row.tempId, { unitCost: value })}
          className={cn(
            "text-right",
            missing &&
              "border-warning/70 hover:border-warning focus:border-warning focus:ring-warning/25",
          )}
        />
        {missing && (
          <p className="mt-1 text-[11px] font-medium text-warning-text">
            Falta el costo
          </p>
        )}
      </div>
    );
  };

  const taxInput = (row: PurchaseOrderItemRow, layout: "table" | "list") => (
    <Input
      type="number"
      min={0}
      max={100}
      step="0.1"
      aria-label={`IVA de ${row.productName}`}
      value={row.taxRate}
      onChange={(event) =>
        updateRow(row.tempId, { taxRate: Number(event.target.value) || 0 })
      }
      className="text-right"
      data-tax-layout={layout}
      data-tax-row={row.tempId}
    />
  );

  const removeButton = (row: PurchaseOrderItemRow) => (
    <button
      type="button"
      onClick={() => removeRow(row.tempId)}
      aria-label={`Quitar ${row.productName}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );

  const lineTotal = (row: PurchaseOrderItemRow) => row.qtyOrdered * row.unitCost;

  const resultsPanel = placement ? (
    <ul
      ref={popoverRef}
      id={resultsId}
      role="listbox"
      aria-label="Resultados de productos"
      style={{
        position: "fixed",
        left: placement.left,
        width: placement.width,
        top: placement.top,
        bottom: placement.bottom,
      }}
      className="scrollbar-app z-[80] max-h-72 overflow-y-auto rounded-lg border border-border/70 bg-card py-1 shadow-lg shadow-black/10"
    >
      {products.length === 0 ? (
        <li className="px-3 py-4 text-center text-xs text-muted-foreground">
          Sin resultados para esa búsqueda
        </li>
      ) : (
        products.map((product, index) => {
          const added = rows.some((row) => row.productId === product.id);
          return (
            <li key={product.id}>
              <button
                type="button"
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={added || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addProduct(product)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                  index === activeIndex && "bg-muted",
                  added ? "cursor-default opacity-70" : "cursor-pointer hover:bg-muted/50",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {product.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground tabular-nums">
                    {product.sku} · Costo {formatCurrency(product.costPrice)}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                  {added ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Check className="w-3.5 h-3.5" /> Agregado
                    </span>
                  ) : (
                    <Plus className="w-4 h-4 text-primary-text" />
                  )}
                </span>
              </button>
            </li>
          );
        })
      )}
    </ul>
  ) : null;

  return (
    // No overflow clipping here: the results popover overhangs the rows below it.
    <div
      ref={rootRef}
      data-testid="purchase-order-item-editor"
      className="@container rounded-xl border border-border/70 bg-card shadow-2xs"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
        <h2 className="text-xs font-semibold text-foreground">
          {title}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            ({rows.length})
          </span>
        </h2>
      </div>

      <div className="border-b border-border/60 px-4 py-3">
        <div ref={anchorRef} className="relative">
          <Input
            id={searchId}
            type="text"
            inputMode="search"
            role="combobox"
            aria-label="Buscar producto"
            aria-expanded={open}
            aria-controls={open ? resultsId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && products[activeIndex] ? optionId(activeIndex) : undefined}
            autoComplete="off"
            icon={<Search className="h-3.5 w-3.5" />}
            placeholder="Busca un producto por nombre o SKU…"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleSearchKeyDown}
          />

          {open && placement && resultsPanel
            ? createPortal(resultsPanel, document.body)
            : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          className="min-h-[168px]"
          icon={<ClipboardList className="w-5 h-5" />}
          title="Busca un producto para agregarlo"
          subtitle="Escribe el nombre o el SKU y elige el producto de la lista."
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-b-xl @2xl:block @2xl:overflow-x-auto">
            <Table className="min-w-[620px]">
              <TableHeader>
                <TableRow>
                  <TableCell as="th" className="pl-4">Producto</TableCell>
                  <TableCell as="th" className="w-24 px-2 text-right">
                    Cant.
                  </TableCell>
                  <TableCell as="th" className="w-36 px-2 text-right">
                    Costo unit.
                  </TableCell>
                  <TableCell as="th" className="w-24 px-2 text-right">
                    IVA %
                  </TableCell>
                  <TableCell as="th" className="w-28 px-2 text-right">
                    Subtotal
                  </TableCell>
                  <TableCell as="th" className="w-12">
                    <span className="sr-only">Acciones</span>
                  </TableCell>
                </TableRow>
              </TableHeader>
              <tbody>
                {rows.map((row) => (
                  <TableRow key={row.tempId}>
                    <TableCell className="pl-4">
                      <p className="max-w-[220px] truncate text-xs font-semibold text-foreground">
                        {row.productName}
                      </p>
                      <p className="text-[11px] font-mono text-muted-foreground">
                        {row.productSku}
                      </p>
                    </TableCell>
                    <TableCell className="px-2 text-right">{qtyInput(row, "table")}</TableCell>
                    <TableCell className="px-2">{costInput(row, "table")}</TableCell>
                    <TableCell className="px-2 text-right">{taxInput(row, "table")}</TableCell>
                    <TableCell className="whitespace-nowrap px-2 text-right text-xs font-semibold text-foreground tabular-nums">
                      {formatCurrency(lineTotal(row))}
                    </TableCell>
                    <TableCell className="pr-2 text-right">{removeButton(row)}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </div>

          <div
            data-testid="draft-item-list"
            className="divide-y divide-border/60 rounded-b-xl @2xl:hidden"
          >
            {rows.map((row) => (
              <div key={row.tempId} data-testid="draft-item-row" className="space-y-2.5 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold text-foreground">
                      {row.productName}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                      {row.productSku}
                    </p>
                  </div>
                  {removeButton(row)}
                </div>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <dt className="text-muted-foreground">Cant.</dt>
                    <dd>{qtyInput(row, "list")}</dd>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <dt className="text-muted-foreground">Costo</dt>
                    <dd>{costInput(row, "list")}</dd>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <dt className="text-muted-foreground">IVA %</dt>
                    <dd>{taxInput(row, "list")}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Subtotal{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCurrency(lineTotal(row))}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
