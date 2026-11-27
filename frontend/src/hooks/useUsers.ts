"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { User } from "@/types";

/**
 * The roles the team screen can hand out. Every value is a real `OrgRole`; the
 * server's `CreateUserDto` validates it with `@IsEnum(OrgRole)`, so MEMBER rides
 * the payload exactly like the others. OWNER is absent on purpose: it is minted
 * only by another OWNER or a SUPER_ADMIN.
 */
type TeamScreenRole = "ADMIN" | "MEMBER" | "CASHIER" | "INVENTORY_USER";

type CreateUserPayload = {
  email: string;
  password: string;
  name: string;
  role: TeamScreenRole;
};

// `PUT /users/:id` accepts only name and email, and the global ValidationPipe
// rejects any other property (400), so a role cannot be part of an edit.
type UpdateUserPayload = {
  name?: string;
  email?: string;
};

async function getUsersRequest() {
  return api.get<User[]>("/users");
}

async function createUserRequest(data: CreateUserPayload) {
  return api.post<User>("/users", data);
}

async function updateUserRequest(id: string, data: UpdateUserPayload) {
  return api.put<User>(`/users/${id}`, data);
}

async function toggleUserActiveRequest(id: string) {
  return api.put<User>(`/users/${id}/toggle-active`, {});
}

async function deleteUserRequest(id: string) {
  return api.delete(`/users/${id}`);
}

async function resetPasswordRequest(userId: string, newPassword: string) {
  return api.post(`/users/${userId}/reset-password`, { newPassword });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserPayload) =>
      createUserRequest(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserPayload }) =>
      updateUserRequest(id, data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useToggleUserActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => toggleUserActiveRequest(id).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteUserRequest(id).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      resetPasswordRequest(userId, newPassword),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => getUsersRequest().then((res) => res.data),
  });
}
