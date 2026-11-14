"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ShiftKind = "FULL_DAY" | "PARTIAL_DAY";
export interface EmployeeShift { id: string; employeeId: string; date: string; kind: ShiftKind; amount: string; observation: string | null }
export interface CreateShift { employeeId: string; date: string; kind: ShiftKind; amount: number; observation?: string }
export function useEmployeeShifts(employeeId: string, enabled: boolean) {
  return useQuery({ queryKey: ["employee-shifts", employeeId], queryFn: () => api.get<EmployeeShift[]>(`/employees/${encodeURIComponent(employeeId)}/shifts`).then((r) => r.data), enabled });
}
export function useCreateEmployeeShift() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (data: CreateShift) => api.post<EmployeeShift>("/employees/shifts", data).then((r) => r.data), onSuccess: (_, data) => client.invalidateQueries({ queryKey: ["employee-shifts", data.employeeId] }) });
}
