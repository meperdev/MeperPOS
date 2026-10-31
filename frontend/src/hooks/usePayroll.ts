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
  // S7/S8: money an employee actually gave back for a whole paid installment.
  // It never rewrites the original cash outflow, so a returned installment keeps
  // its own date and method and adds the day and method the money came back by.
  cashReturn?: PayrollCashReturn | null;
}

export interface PayrollCashReturn {
  id: string;
  amount: string;
  returnDate: string;
  returnMethod: PayrollPaymentMethod;
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

// S6: a correction fixes an amount that was recorded wrongly. It carries no new
// cash date or method — the outflow keeps its own — and no expense date, because
// the server decides that date (a stored selection wins, otherwise the correction
// day). An amount that reaches the exact outstanding total completes the payment.
export interface CorrectPayrollInstallmentInput {
  employeeId: string;
  obligationId: string;
  installmentId: string;
  amount: string;
}

// S7/S8: a real return of money the employee had received. The actor states only
// the two facts the approved decisions leave to a human — the day the money came
// back (L325) and the real method it came back by (L330). The returned amount is
// deliberately absent: one return covers exactly one complete installment (L329),
// so the server takes it from the stored cash outflow.
export interface CreatePayrollCashReturnInput {
  employeeId: string;
  obligationId: string;
  installmentId: string;
  returnDate: string;
  returnMethod: PayrollPaymentMethod;
}

// S6/S7 (L327, L338): a completed payment is never edited. A replacement is a
// NEW pending payment that references the valid installments of the completed
// one, so their cash counts as paid without a new cash outflow. The amount is
// deliberately absent: the server reads it from the referenced outflows, and the
// period, the state and every money value stay server-owned. The expense choice
// is per payment (S5), so it is stated here and applied when the new payment
// completes.
export interface CreatePayrollReplacementPaymentInput extends PayrollExpenseChoice {
  employeeId: string;
  sourceObligationId: string;
  installmentIds: string[];
  periodStart: string;
  periodEnd: string;
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

export function useCorrectPayrollPeriodInstallment() {
  return usePayrollMutation<CorrectPayrollInstallmentInput>("/payroll/period-installments/correct");
}

export function useCreatePayrollCashReturn() {
  return usePayrollMutation<CreatePayrollCashReturnInput>("/payroll/cash-returns");
}

export function useCreatePayrollReplacementPayment() {
  return usePayrollMutation<CreatePayrollReplacementPaymentInput>("/payroll/replacement-payments");
}
