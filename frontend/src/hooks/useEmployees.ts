"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type EmployeeModality = "FIXED" | "BY_DAY" | "OTHER";
export interface Employee {
  id: string; name: string; identification: string | null; phone: string | null;
  email: string | null; address: string | null; jobTitle: string | null;
  startDate: string | null; remunerationModality: EmployeeModality | null;
  referenceAmount: string | null; active: boolean;
}
export type EmployeePayload = Pick<Employee, "name" | "identification" | "phone" | "email" | "address" | "jobTitle" | "startDate" | "remunerationModality"> & { referenceAmount: number | null };
export function useEmployees(enabled: boolean) {
  return useQuery({ queryKey: ["employees"], queryFn: () => api.get<Employee[]>("/employees").then((r) => r.data), enabled });
}
export function useCreateEmployee() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (data: EmployeePayload) => api.post<Employee>("/employees", data).then((r) => r.data), onSuccess: () => client.invalidateQueries({ queryKey: ["employees"] }) });
}
export function useUpdateEmployee() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, data }: { id: string; data: EmployeePayload }) => api.patch<Employee>(`/employees/${encodeURIComponent(id)}`, data).then((r) => r.data), onSuccess: () => client.invalidateQueries({ queryKey: ["employees"] }) });
}
export function useSetEmployeeActive() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch<Employee>(`/employees/${encodeURIComponent(id)}/active`, { active }).then((r) => r.data), onSuccess: () => client.invalidateQueries({ queryKey: ["employees"] }) });
}
