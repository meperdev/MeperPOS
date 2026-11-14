"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

export interface BusinessModule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

/**
 * The server owns the module catalog and each organization's state for it.
 * This hook only reads that answer; it never derives availability locally.
 */
export function useBusinessModules() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["business-modules", user?.organizationId],
    queryFn: () => api.get<BusinessModule[]>("/business-modules").then((res) => res.data),
    enabled: !!user,
  });
}

/**
 * Selector over the catalog for the surfaces that gate one capability.
 */
export function useVehiclesModule() {
  const modules = useBusinessModules();
  return {
    ...modules,
    data: modules.data?.find((module) => module.id === "vehicles"),
  };
}
