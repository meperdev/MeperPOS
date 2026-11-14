"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

export function useVehiclesModule() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["business-modules", user?.organizationId, "vehicles"],
    queryFn: () => api.get<{ enabled: boolean }>("/business-modules/vehicles").then((res) => res.data),
    enabled: !!user,
  });
}
