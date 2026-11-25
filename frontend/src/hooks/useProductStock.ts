"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LocationType, Product } from "@/types";

/**
 * T22 — per-site inventory read and adjustment.
 *
 * `ProductStock` is the per-site ledger and `Product.stock` is the
 * organization-wide aggregate it sums to, so the inventory screen needs two
 * things the product payload cannot answer: the balance of each site the caller
 * may read, and a way to move one site's units. Both live here, keyed per
 * product, and both are typed locally: they belong to this screen, not to the
 * shared product model.
 */

/** One site's balance of one product, as the breakdown endpoint returns it. */
export interface ProductSiteStock {
  locationId: string;
  name: string;
  type: LocationType;
  isDefault: boolean;
  stock: number;
  reservedStock: number;
  availableStock: number;
}

/** A signed per-site move: positive enters the site, negative leaves it. */
export interface StockAdjustmentPayload {
  productId: string;
  locationId: string;
  quantity: number;
  reason: string;
}

/** What one adjustment changed: the refreshed product and its site balance. */
export interface SiteStockAdjustmentResult {
  product: Product;
  site: ProductSiteStock;
}

/** Every surface that reads one product's site balances uses this key. */
export const productStockQueryKey = (productId: string) =>
  ["product-stock", productId] as const;

function stockBySiteRequest(productId: string) {
  return api
    .get<ProductSiteStock[]>(
      `/products/${encodeURIComponent(productId)}/stock-by-site`,
    )
    .then(({ data }) => data);
}

function adjustStockRequest({
  productId,
  locationId,
  quantity,
  reason,
}: StockAdjustmentPayload) {
  return api
    .post<SiteStockAdjustmentResult>(
      `/products/${encodeURIComponent(productId)}/stock-adjustments`,
      { locationId, quantity, reason },
    )
    .then(({ data }) => data);
}

/** The balance of every site the caller may read; missing rows read as zero. */
export function useProductStockBySite(productId: string | null | undefined) {
  return useQuery({
    queryKey: productStockQueryKey(productId ?? "none"),
    queryFn: () => stockBySiteRequest(productId as string),
    enabled: Boolean(productId),
  });
}

/**
 * Moves one site's units and refreshes every read that shows them: the product
 * detail, the inventory list (both the aggregate and any site projection) and
 * this product's breakdown.
 */
export function useAdjustProductStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: StockAdjustmentPayload) => adjustStockRequest(payload),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({
        queryKey: ["product", variables.productId],
      });
      void queryClient.invalidateQueries({
        queryKey: productStockQueryKey(variables.productId),
      });
    },
  });
}
