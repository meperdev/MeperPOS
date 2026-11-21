import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const useTasksMock = vi.fn();

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
  useTaskTimeline: () => ({ data: [], isLoading: false }),
  useCreateTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    status: "PENDING",
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

/** The row of one task in the list, so two tasks read apart. */
function rowOf(taskId: string) {
  const row = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!row) throw new Error(`No row for ${taskId}`);
  return within(row as HTMLElement);
}

describe("Tasks page overdue badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("leaves a day-shaped task due today alone at 21:00 in Bogotá and still flags yesterday", () => {
    // 2026-11-20T02:00Z is 21:00 on 19 November in Bogotá: UTC has rolled over
    // and the shop's calendar day has not. Freezing only `Date` keeps React and
    // the page's timers real.
    vi.useFakeTimers({
      now: new Date("2026-11-20T02:00:00.000Z"),
      toFake: ["Date"],
    });
    useTasksMock.mockReturnValue({
      data: {
        tasks: [
          makeTask({ id: "task-today", dueDate: "2026-11-19T00:00:00.000Z" }),
          makeTask({
            id: "task-yesterday",
            title: "Cuadrar caja",
            dueDate: "2026-11-18T00:00:00.000Z",
          }),
        ],
        source: "remote",
      },
      isLoading: false,
    });

    render(<TasksPage />);

    expect(screen.getAllByText(/\(Vencida\)/)).toHaveLength(1);
    expect(rowOf("task-today").queryByText(/\(Vencida\)/)).toBeNull();
    // The boundary still moves at the shop's midnight, not later.
    expect(rowOf("task-yesterday").getByText(/\(Vencida\)/)).toBeTruthy();
  });

  it("flags the day-shaped task due today once the shop is on the next day", () => {
    // 2026-11-20T05:30Z is 00:30 on 20 November in Bogotá.
    vi.useFakeTimers({
      now: new Date("2026-11-20T05:30:00.000Z"),
      toFake: ["Date"],
    });
    useTasksMock.mockReturnValue({
      data: {
        tasks: [
          makeTask({ id: "task-today", dueDate: "2026-11-19T00:00:00.000Z" }),
        ],
        source: "remote",
      },
      isLoading: false,
    });

    render(<TasksPage />);

    expect(rowOf("task-today").getByText(/\(Vencida\)/)).toBeTruthy();
  });

  it("does not flag a completed task whose due date passed", () => {
    vi.useFakeTimers({
      now: new Date("2026-11-20T05:30:00.000Z"),
      toFake: ["Date"],
    });
    useTasksMock.mockReturnValue({
      data: {
        tasks: [
          makeTask({
            id: "task-done",
            status: "COMPLETED",
            dueDate: "2026-11-18T00:00:00.000Z",
          }),
        ],
        source: "remote",
      },
      isLoading: false,
    });

    render(<TasksPage />);

    expect(rowOf("task-done").queryByText(/\(Vencida\)/)).toBeNull();
  });
});
