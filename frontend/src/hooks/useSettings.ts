"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Settings,
  InventoryMovement,
  PaginatedResponse,
  PurchaseOrderTemplate,
} from "@/types";

export interface UpdateSettingsInput {
  printHeader?: string;
  printFooter?: string;
  /** A partial write: only the fields sent are replaced. */
  purchaseOrderTemplate?: Partial<PurchaseOrderTemplate>;
  custom?: Record<string, unknown>;
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api.get<Settings>("/settings").then((res) => res.data),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateSettingsInput) =>
      api.put<Settings>("/settings", data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useUploadLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api
        .postWithFormData<{ logoUrl: string }>("/settings/logo", formData)
        .then((res) => res.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useUpdateOrganizationName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      api.patch<Settings>("/settings/organization", { name }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useUpdateReceiptPrefix() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (prefix: string) =>
      api
        .patch<Settings>("/settings/receipt-prefix", { prefix })
        .then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useInventoryMovements(params?: {
  page?: number;
  limit?: number;
  productId?: string;
}) {
  return useQuery({
    queryKey: ["inventory-movements", params],
    queryFn: () =>
      api.get<PaginatedResponse<InventoryMovement>>("/exports/inventory", {
        ...params,
        format: "json",
      }).then((res) => res.data),
  });
}
