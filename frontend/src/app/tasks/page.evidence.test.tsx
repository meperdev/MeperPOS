import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const useTasksMock = vi.fn();
const useTaskTimelineMock = vi.fn();
const useCreateTaskMock = vi.fn();
const useUpdateTaskMock = vi.fn();
const useUpdateTaskStatusMock = vi.fn();
const useDeleteTaskMock = vi.fn();

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Ana Admin", role: "ADMIN" },
  }),
}));

vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => useTasksMock(),
  useTaskAssignees: () => ({ data: [], isLoading: false }),
  useTaskTimeline: (taskId: string, options?: { enabled?: boolean }) =>
    useTaskTimelineMock(taskId, options),
  useCreateTask: () => useCreateTaskMock(),
  useUpdateTask: () => useUpdateTaskMock(),
  useUpdateTaskStatus: () => useUpdateTaskStatusMock(),
  useDeleteTask: () => useDeleteTaskMock(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import TasksPage from "./page";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Revisar vitrina",
    description: null,
    status: "IN_PROGRESS",
    createdById: "user-1",
    assignedToId: null,
    dueDate: null,
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T13:00:00.000Z",
    createdBy: { id: "user-1", name: "Ana Admin" },
    assignedTo: null,
    ...overrides,
  };
}

describe("Tasks module evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useTasksMock.mockReturnValue({ data: { tasks: [], source: "remote" }, isLoading: false });
    useTaskTimelineMock.mockReturnValue({ data: [], isLoading: false });
    useCreateTaskMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useUpdateTaskMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useDeleteTaskMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows backend-driven timeline content", () => {
    useTasksMock.mockReturnValue({
      data: {
        tasks: [makeTask()],
        source: "remote",
      },
      isLoading: false,
    });
    useTaskTimelineMock.mockReturnValue({
      data: [
        {
          id: "event-1",
          taskId: "task-1",
          type: "STATUS_CHANGED",
          fromStatus: "PENDING",
          toStatus: "IN_PROGRESS",
          note: "Tomada por caja",
          createdById: "user-1",
          createdAt: "2026-01-10T13:00:00.000Z",
          createdBy: { id: "user-1", name: "Ana Admin" },
        },
      ],
      isLoading: false,
    });

    render(<TasksPage />);

    // Spec (mod 13) dropped the "API real" tag; the timeline is backend-driven and append-only.
    expect(screen.queryByText("API real")).toBeNull();
    expect(screen.getByText("Historial")).toBeTruthy();
    expect(screen.getByText("Cambio de estado")).toBeTruthy();
    expect(screen.getByText(/Pendiente\s*(->|→)\s*En curso/i)).toBeTruthy();
    expect(screen.getByText(/Ana Admin - Tomada por caja/i)).toBeTruthy();
  });

  it("edits the selected task against the backend update endpoint", async () => {
    useTasksMock.mockReturnValue({
      data: {
        tasks: [makeTask({ description: "Pendiente de revision" })],
        source: "remote",
      },
      isLoading: false,
    });

    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    useUpdateTaskMock.mockReturnValue({ mutateAsync, isPending: false });

    render(<TasksPage />);

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));

    const titleInput = screen.getByDisplayValue("Revisar vitrina");
    const descriptionInput = screen.getByDisplayValue("Pendiente de revision");

    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Revisar vitrina principal");
    await userEvent.clear(descriptionInput);
    await userEvent.type(descriptionInput, "Validar carteles y precios");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "task-1",
        data: {
          title: "Revisar vitrina principal",
          description: "Validar carteles y precios",
        },
      });
    });
  });

  it("clears the selected timeline query before deleting the selected task", async () => {
    useTasksMock.mockReturnValue({
      data: {
        tasks: [makeTask()],
        source: "remote",
      },
      isLoading: false,
    });

    let resolveDelete: (() => void) | undefined;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    const mutateAsync = vi.fn().mockReturnValue(deletePromise);
    useDeleteTaskMock.mockReturnValue({ mutateAsync, isPending: false });

    render(<TasksPage />);

    await waitFor(() => {
      expect(useTaskTimelineMock).toHaveBeenLastCalledWith("task-1", { enabled: true });
    });

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => {
      expect(useTaskTimelineMock).toHaveBeenLastCalledWith("", { enabled: false });
    });

    resolveDelete?.();

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith("task-1");
    });
  });

  it("switches away from a completed selection before bulk delete", async () => {
    useTasksMock.mockReturnValue({
      data: {
        tasks: [
          makeTask({ id: "task-completed", status: "COMPLETED" }),
          makeTask({
            id: "task-pending",
            title: "Contar caja",
            status: "PENDING",
          }),
        ],
        source: "remote",
      },
      isLoading: false,
    });

    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    useDeleteTaskMock.mockReturnValue({ mutateAsync, isPending: false });

    render(<TasksPage />);

    await waitFor(() => {
      expect(useTaskTimelineMock).toHaveBeenLastCalledWith("task-completed", {
        enabled: true,
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "Borrar completadas" }));
    await userEvent.click(screen.getByRole("button", { name: "Borrar todas" }));

    await waitFor(() => {
      expect(useTaskTimelineMock).toHaveBeenLastCalledWith("task-pending", {
        enabled: true,
      });
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith("task-completed");
  });

  it("keeps the history list free of sideways scroll and lets long text wrap", () => {
    useTasksMock.mockReturnValue({
      data: { tasks: [makeTask()], source: "remote" },
      isLoading: false,
    });
    useTaskTimelineMock.mockReturnValue({
      data: [
        {
          id: "event-1",
          taskId: "task-1",
          type: "STATUS_CHANGED",
          fromStatus: "PENDING",
          toStatus: "IN_PROGRESS",
          note: null,
          createdById: "user-1",
          createdAt: "2026-01-10T13:00:00.000Z",
          createdBy: { id: "user-1", name: "Ana Admin" },
        },
      ],
      isLoading: false,
    });

    render(<TasksPage />);

    const label = screen.getByText("Cambio de estado");
    const list = label.closest(".max-h-40");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("overflow-x-hidden");

    const row = label.closest("div.flex.items-start")!;
    expect(label.className).toContain("break-words");
    expect(label.className).not.toContain("truncate");
    expect(row.querySelector(".tabular-nums")!.className).not.toContain("shrink-0");
  });

  it("stacks the detail header by panel width so the title keeps its room beside the actions", () => {
    useTasksMock.mockReturnValue({
      data: { tasks: [makeTask()], source: "remote" },
      isLoading: false,
    });

    render(<TasksPage />);

    const panel = screen.getByRole("button", { name: "Editar" }).closest("[class~='@container']");
    expect(panel).not.toBeNull();

    const title = panel!.querySelector("h2")!;
    expect(title.textContent).toBe("Revisar vitrina");
    expect(title.className).toContain("break-words");
    expect(title.className).not.toContain("truncate");

    const titleBlock = title.parentElement!;
    expect(titleBlock.className).toContain("min-w-0");

    const header = titleBlock.parentElement!;
    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("@md:flex-row");
    expect(header.className).toContain("@md:items-start");
    expect(header.className).toContain("@md:justify-between");
    expect(header.className).not.toContain("sm:flex-row");
  });
});
