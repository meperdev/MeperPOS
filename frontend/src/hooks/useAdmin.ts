"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface OrganizationUser {
  id: string;
  role: string;
  isPrimaryOwner: boolean;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    active: boolean;
  };
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  billingStatus: string | null;
  taxId: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
  users?: OrganizationUser[];
  sequences?: Array<{
    id: string;
    type: string;
    prefix: string | null;
    currentNumber: number;
    year: number | null;
  }>;
}

export interface AdminMetrics {
  totalOrganizations: number;
  activeOrganizations: number;
  trialOrganizations: number;
  pastDueOrganizations: number;
  suspendedOrganizations: number;
  trialExpiringSoon: number;
  trialExpired: number;
  billingOverdue: number;
  newOrganizationsThisMonth: number;
  totalUsers: number;
  activeUsers: number;
  organizationsByPlan: Record<string, number>;
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () =>
      api.get<Organization[]>('/admin/organizations').then((res) => res.data),
  });
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['admin', 'organization', id],
    queryFn: () =>
      api.get<Organization>(`/admin/organizations/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      api.post('/admin/organizations', data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'metrics'] });
    },
  });
}

export function useUpdateOrganizationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/admin/organizations/${id}/status`, { status }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'metrics'] });
    },
  });
}

export function useUpdateOrganizationPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) =>
      api.patch(`/admin/organizations/${id}/plan`, { plan }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization'] });
    },
  });
}

export function useAdminMetrics() {
  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () =>
      api.get<AdminMetrics>('/admin/metrics').then((res) => res.data),
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; slug?: string; taxId?: string; phone?: string; address?: string; logoUrl?: string; active?: boolean }) =>
      api.patch(`/admin/organizations/${id}`, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization'] });
    },
  });
}

export function useAddOrganizationMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; email: string; name?: string; role: string; password?: string }) =>
      api.post(`/admin/organizations/${id}/members`, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization'] });
    },
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, userId, role }: { orgId: string; userId: string; role: string }) =>
      api.patch(`/admin/organizations/${orgId}/members/${userId}/role`, { role }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization'] });
    },
  });
}

export function useRemoveOrganizationMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, userId }: { orgId: string; userId: string }) =>
      api.delete(`/admin/organizations/${orgId}/members/${userId}`).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization'] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmOrganizationName }: { id: string; confirmOrganizationName: string }) =>
      api.delete(`/admin/organizations/${id}`, { data: { confirmOrganizationName } }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'metrics'] });
    },
  });
}
