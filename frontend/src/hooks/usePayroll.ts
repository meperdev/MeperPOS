"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type PayrollObligationKind = "FIXED_PERIOD" | "SHIFT_GROUP";
export type PayrollObligationStatus = "PENDING" | "COMPLETED";
export type PayrollPaymentMethod = "CASH" | "CARD" | "TRANSFER";

// The server computes every money value and sends it as a decimal string. The
// UI reads `summary` and never sums installments itself.
export interface PayrollObligationSummary {
  total: string;
  paid: string;
  balance: string;
  status: "pending" | "completed";
}

export interface PayrollInstallment {
  id: string;
  outflowId: string;
  createdAt: string;
  outflow: {
    id: string;
    amount: string;
    date: string;
    method: PayrollPaymentMethod;
    createdAt: string;
  };
}

export interface PayrollShiftMembership {
  id: string;
  shiftId: string;
  releasedAt: string | null;
  shift: { id: string; date: string; kind: "FULL_DAY" | "PARTIAL_DAY"; amount: string };
}

export interface PayrollObligation {
  id: string;
  employeeId: string;
  kind: PayrollObligationKind;
  status: PayrollObligationStatus;
  version: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodAmount: string | null;
  expenseEnabled: boolean | null;
  selectedExpenseDate: string | null;
  createdAt: string;
  updatedAt: string;
  installments: PayrollInstallment[];
  shiftMemberships: PayrollShiftMembership[];
  summary: PayrollObligationSummary;
}

// The stored per-payment expense decision. There is no default: sending
// `expenseEnabled: false` is an explicit "no expense", and the optional date is
// only sent when the user chose to generate one.
export interface PayrollExpenseChoice {
  expenseEnabled: boolean;
  selectedExpenseDate?: string | null;
}

export interface CreatePayrollPeriodInput extends PayrollExpenseChoice {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  // Decimal string, exactly as typed: the route rejects anything else.
  periodAmount: string;
}

export interface CreatePayrollGroupInput extends PayrollExpenseChoice {
  employeeId: string;
  shiftIds: string[];
}

export interface CreatePayrollInstallmentInput {
  employeeId: string;
  obligationId: string;
  amount: string;
  date: string;
  method: PayrollPaymentMethod;
}

const OBLIGATIONS_KEY = ["payroll-obligations"];

export function usePayrollObligations(enabled: boolean) {
  return useQuery({
    queryKey: OBLIGATIONS_KEY,
    queryFn: () => api.get<PayrollObligation[]>("/payroll/obligations").then((r) => r.data),
    enabled,
  });
}

// Every payment and installment changes the obligation list, its cash history
// and the derived summary, so the read route is always refreshed on success.
// The routes answer with different shapes (an obligation for a new payment, the
// written installment facts for an abono) and this screen only needs the list
// refresh, so the response stays untyped rather than claiming one shape.
function usePayrollMutation<TInput>(path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: TInput) => api.post<unknown>(path, data).then((r) => r.data),
    onSuccess: () => client.invalidateQueries({ queryKey: OBLIGATIONS_KEY }),
  });
}

export function useCreatePayrollPeriod() {
  return usePayrollMutation<CreatePayrollPeriodInput>("/payroll/periods");
}

export function useCreatePayrollGroup() {
  return usePayrollMutation<CreatePayrollGroupInput>("/payroll/groups");
}

export function useCreatePayrollPeriodInstallment() {
  return usePayrollMutation<CreatePayrollInstallmentInput>("/payroll/period-installments");
}

export function useCreatePayrollGroupInstallment() {
  return usePayrollMutation<CreatePayrollInstallmentInput>("/payroll/group-installments");
}
