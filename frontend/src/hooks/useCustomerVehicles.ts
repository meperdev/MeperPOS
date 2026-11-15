"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

interface CustomerVehicle { id: string; plate: string; model: string | null }

export function useCustomerVehicles(customerId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["customer-vehicles", user?.organizationId, customerId],
    queryFn: () => api.get<CustomerVehicle[]>(`/customers/${customerId}/vehicles`).then((res) => res.data),
    enabled: !!customerId,
  });
}

export function useUpdateCustomerVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, vehicleId, ...data }: { customerId: string; vehicleId: string; plate: string; model: string }) =>
      api.patch(`/customers/${customerId}/vehicles/${vehicleId}`, data).then((res) => res.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customer-vehicles"] }); },
  });
}

export function useCreateCustomerVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, ...data }: { customerId: string; plate: string; model?: string }) =>
      api.post(`/customers/${customerId}/vehicles`, data).then((res) => res.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customer-vehicles"] }); },
  });
}
