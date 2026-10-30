"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Task,
  TaskEvent,
  TaskListResult,
  TaskStatus,
} from "@/types";

export type CreateTaskPayload = {
  title: string;
  description?: string;
  assignedToId?: string | null;
  dueDate?: string | null;
};

export type UpdateTaskPayload = {
  title?: string;
  description?: string | null;
  assignedToId?: string | null;
  dueDate?: string | null;
};

export type TaskAssignee = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type QueryTasksParams = {
  search?: string;
  status?: TaskStatus;
  myTasksOnly?: boolean;
  assignedToId?: string;
  includeCompleted?: boolean;
};

type TimelineQueryOptions = {
  enabled?: boolean;
};

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  return (error as { response?: { status?: number } }).response?.status;
}

export function useTasks(
  params?: QueryTasksParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: async (): Promise<TaskListResult> => {
      const response = await api.get<Task[]>("/tasks", {
        includeCompleted: params?.includeCompleted ?? true,
        limit: 50,
        ...params,
      });
      return { tasks: response.data, source: "remote" };
    },
    enabled: options?.enabled ?? true,
  });
}

export function useTaskAssignees() {
  return useQuery({
    queryKey: ["tasks", "assignees"],
    queryFn: async (): Promise<TaskAssignee[]> => {
      const response = await api.get<TaskAssignee[]>("/tasks/assignees");
      return response.data;
    },
  });
}

export function useTaskTimeline(taskId: string, options?: TimelineQueryOptions) {
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ["tasks", taskId, "timeline"],
    queryFn: async () => {
      const response = await api.get<TaskEvent[]>(`/tasks/${taskId}/timeline`);
      return response.data;
    },
    enabled: enabled && !!taskId,
    retry: (failureCount, error) => {
      if (getErrorStatus(error) === 404) {
        return false;
      }

      return failureCount < 3;
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateTaskPayload) =>
      api.post<Task>("/tasks", payload).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskPayload }) =>
      api.put<Task>(`/tasks/${id}`, data).then((response) => response.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", variables.id, "timeline"] });
    },
  });
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string;
      status: TaskStatus;
      note?: string;
    }) => api.put<Task>(`/tasks/${id}/status`, { status, note }).then((response) => response.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", variables.id, "timeline"] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", id, "timeline"] });
    },
  });
}
