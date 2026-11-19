"use client";

import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppRole } from "@/lib/auth";
import {
  canSearchCustomers,
  canSearchSales,
  productSearchSource,
  salesSearchTerm,
  type CommandProductSource,
} from "@/lib/command-palette";
import type {
  Customer,
  PaginatedResponse,
  Product,
  Sale,
  SearchProductResult,
} from "@/types";

/** Two characters is enough to be a query; one is still typing. */
export const COMMAND_SEARCH_MIN_CHARS = 2;
/** Long enough that a fast typist sends one request, short enough to feel live. */
export const COMMAND_SEARCH_DEBOUNCE_MS = 200;
/** A group is a shortcut to a record, not a second list screen. */
export const COMMAND_GROUP_LIMIT = 5;

export interface CommandProductHit {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  /** The server's selling price (promotion already applied). */
  price: number;
}

export interface CommandCustomerHit {
  id: string;
  name: string;
  documentNumber: string;
}

export interface CommandSaleHit {
  id: string;
  saleNumber: number;
  total: number;
  customerName: string | null;
}

export type CommandGroupStatus = "idle" | "loading" | "ready" | "error";

export interface CommandGroupResult<T> {
  status: CommandGroupStatus;
  items: T[];
}

export interface CommandSearchState {
  products: CommandGroupResult<CommandProductHit>;
  customers: CommandGroupResult<CommandCustomerHit>;
  sales: CommandGroupResult<CommandSaleHit>;
}

/**
 * Debounced value that starts settled on `""`.
 *
 * Starting empty (instead of on the first value) means the first keystroke is
 * debounced like every other one: mounting the palette around a query already
 * in the field would otherwise send a request the operator never waited for.
 */
function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (value === debounced) return;
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, debounced, delay]);

  return debounced;
}

async function fetchProducts(
  source: CommandProductSource,
  term: string,
): Promise<CommandProductHit[]> {
  if (source === "search") {
    const { data } = await api.get<SearchProductResult[]>("/products/search", {
      q: term,
      limit: COMMAND_GROUP_LIMIT,
    });
    return data.map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode ?? null,
      price: Number(item.effectiveSalePrice ?? item.salePrice),
    }));
  }

  const { data } = await api.get<PaginatedResponse<Product>>("/products", {
    search: term,
    limit: COMMAND_GROUP_LIMIT,
    status: "active",
  });
  return data.data.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    barcode: item.barcode ?? null,
    price: Number(item.effectiveSalePrice ?? item.salePrice),
  }));
}

async function fetchCustomers(term: string): Promise<CommandCustomerHit[]> {
  const { data } = await api.get<PaginatedResponse<Customer>>("/customers", {
    search: term,
    limit: COMMAND_GROUP_LIMIT,
  });
  return data.data.map((customer) => ({
    id: customer.id,
    name: customer.name,
    documentNumber: customer.documentNumber,
  }));
}

async function fetchSales(term: string): Promise<CommandSaleHit[]> {
  const { data } = await api.get<PaginatedResponse<Sale>>("/sales", {
    search: term,
    limit: COMMAND_GROUP_LIMIT,
  });
  return data.data.map((sale) => ({
    id: sale.id,
    saleNumber: sale.saleNumber,
    total: Number(sale.total),
    customerName: sale.customer?.name ?? null,
  }));
}

/**
 * One group's answer, read through the query cache.
 *
 * The query key carries the term, so a response that lands after the operator
 * kept typing can only ever fill the entry of the term it answered. Retries are
 * off: the next keystroke is the retry, and a group that failed must not spend
 * three timeouts holding the result list hostage.
 */
function toGroup<T>(query: UseQueryResult<T[]>, enabled: boolean): CommandGroupResult<T> {
  if (!enabled) return { status: "idle", items: [] };
  if (query.isError) return { status: "error", items: [] };
  if (!query.data) return { status: "loading", items: [] };
  return { status: "ready", items: query.data };
}

/**
 * The palette's server-side groups.
 *
 * Each group answers on its own, so a failing endpoint marks only its own rows:
 * a blocked sale search never hides the product the operator was looking for.
 * The role decides which endpoints are asked at all — a group the token cannot
 * read would only ever paint an error.
 */
export function useCommandSearch(
  query: string,
  role: AppRole | string | undefined,
): CommandSearchState {
  const settled = useDebouncedValue(query.trim(), COMMAND_SEARCH_DEBOUNCE_MS);
  const term = settled.length >= COMMAND_SEARCH_MIN_CHARS ? settled : "";

  const productSource = productSearchSource(role);
  const customersAllowed = canSearchCustomers(role);
  const salesTerm = salesSearchTerm(term);
  const salesAllowed = canSearchSales(role) && salesTerm.length > 0;

  const products = useQuery({
    queryKey: ["command-search", "products", productSource, term],
    queryFn: () => fetchProducts(productSource as CommandProductSource, term),
    enabled: Boolean(productSource) && term.length > 0,
    retry: false,
    staleTime: 30_000,
  });

  const customers = useQuery({
    queryKey: ["command-search", "customers", term],
    queryFn: () => fetchCustomers(term),
    enabled: customersAllowed && term.length > 0,
    retry: false,
    staleTime: 30_000,
  });

  const sales = useQuery({
    queryKey: ["command-search", "sales", salesTerm],
    queryFn: () => fetchSales(salesTerm),
    enabled: salesAllowed,
    retry: false,
    staleTime: 30_000,
  });

  return {
    products: toGroup(products, Boolean(productSource) && term.length > 0),
    customers: toGroup(customers, customersAllowed && term.length > 0),
    sales: toGroup(sales, salesAllowed),
  };
}
