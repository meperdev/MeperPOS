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
const toastErrorMock = vi.fn();

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
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

import TasksPage from "./page";

const ROW_HEIGHT = 72;

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-a",
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

function taskOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-task-id]")).map(
    (row) => row.getAttribute("data-task-id") ?? "",
  );
}

function struckTitles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-task-id] [data-struck="true"]'),
  ).map((title) => title.textContent ?? "");
}

/**
 * jsdom lays nothing out, so every rect is zero and no row ever appears to
 * move. This gives each row a position derived from its live DOM order, which
 * is what the FLIP measures before and after the reorder.
 */
function stubRowRects() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rows = Array.from(document.querySelectorAll("[data-task-id]"));
      const row = this.closest?.("[data-task-id]");
      const index = row ? rows.indexOf(row) : -1;
      const top = index >= 0 ? index * ROW_HEIGHT : 0;
      return {
        top,
        bottom: top + ROW_HEIGHT - 8,
        left: 0,
        right: 300,
        width: 300,
        height: ROW_HEIGHT - 8,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
}

function stubAnimate() {
  const animate = vi.fn().mockReturnValue({ cancel: vi.fn(), finished: Promise.resolve() });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  return animate;
}

function stubReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const toggleName = (title: string) => `Cambiar estado rápido de ${title}`;

describe("Tasks completion motion (S4)", () => {
  const openA = makeTask({ id: "task-a", title: "Revisar vitrina", status: "PENDING" });
  const openB = makeTask({ id: "task-b", title: "Contar caja", status: "PENDING" });

  beforeEach(() => {
    vi.clearAllMocks();
    stubReducedMotion(false);

    useTasksMock.mockReturnValue({
      data: { tasks: [openA, openB], source: "remote" },
      isLoading: false,
    });
    useTaskTimelineMock.mockReturnValue({ data: [], isLoading: false });
    useCreateTaskMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useUpdateTaskMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useDeleteTaskMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(window, "matchMedia");
    vi.restoreAllMocks();
  });

  it("strikes a completed task and moves it to the end of the open list", async () => {
    const mutateAsync = vi.fn().mockImplementation(async () => {
      useTasksMock.mockReturnValue({
        data: {
          tasks: [openB, { ...openA, status: "COMPLETED" }],
          source: "remote",
        },
        isLoading: false,
      });
    });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync, isPending: false });

    const { container, rerender } = render(<TasksPage />);

    expect(taskOrder(container)).toEqual(["task-a", "task-b"]);
    expect(struckTitles(container)).toEqual([]);

    await userEvent.click(
      screen.getByRole("button", { name: toggleName("Revisar vitrina") }),
    );

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ id: "task-a", status: "COMPLETED" });
    });

    rerender(<TasksPage />);

    // The strike lands first, in place, so the line can draw without the row
    // being re-inserted; the move to the end follows.
    expect(struckTitles(container)).toEqual(["Revisar vitrina"]);
    expect(taskOrder(container)).toEqual(["task-a", "task-b"]);

    await waitFor(() => {
      expect(taskOrder(container)).toEqual(["task-b", "task-a"]);
    });

    const title = container.querySelector(
      '[data-task-id="task-a"] [data-struck="true"]',
    )!;
    expect(title.className).toContain("task-title-strike");
    expect(title.className).toContain("text-muted-foreground");
  });

  it("keeps keyboard focus on the checkbox of the task it moved", async () => {
    const mutateAsync = vi.fn().mockImplementation(async () => {
      useTasksMock.mockReturnValue({
        data: {
          tasks: [openB, { ...openA, status: "COMPLETED" }],
          source: "remote",
        },
        isLoading: false,
      });
    });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync, isPending: false });

    const { container, rerender } = render(<TasksPage />);

    const checkbox = screen.getByRole("button", {
      name: toggleName("Revisar vitrina"),
    });
    await userEvent.click(checkbox);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    rerender(<TasksPage />);

    await waitFor(() => {
      expect(taskOrder(container)).toEqual(["task-b", "task-a"]);
    });

    expect(
      screen.getByRole("button", { name: toggleName("Revisar vitrina") }),
    ).toHaveFocus();
  });

  it("puts the row back and clears the strike when the server rejects", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("boom"));
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync, isPending: false });

    const { container, rerender } = render(<TasksPage />);

    await userEvent.click(
      screen.getByRole("button", { name: toggleName("Revisar vitrina") }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });

    rerender(<TasksPage />);

    expect(taskOrder(container)).toEqual(["task-a", "task-b"]);
    expect(struckTitles(container)).toEqual([]);
  });

  it("moves an unchecked task back into place and drops the strike", async () => {
    const doneA = makeTask({
      id: "task-a",
      title: "Revisar vitrina",
      status: "COMPLETED",
    });
    useTasksMock.mockReturnValue({
      data: { tasks: [openB, doneA], source: "remote" },
      isLoading: false,
    });

    const mutateAsync = vi.fn().mockImplementation(async () => {
      useTasksMock.mockReturnValue({
        data: {
          tasks: [{ ...doneA, status: "PENDING" }, openB],
          source: "remote",
        },
        isLoading: false,
      });
    });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync, isPending: false });

    const { container, rerender } = render(<TasksPage />);

    expect(taskOrder(container)).toEqual(["task-b", "task-a"]);

    await userEvent.click(
      screen.getByRole("button", { name: toggleName("Revisar vitrina") }),
    );
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ id: "task-a", status: "PENDING" });
    });

    rerender(<TasksPage />);

    expect(taskOrder(container)).toEqual(["task-a", "task-b"]);
    expect(struckTitles(container)).toEqual([]);
  });

  it("animates the move with a transform measured before and after the reorder", async () => {
    stubRowRects();
    const animate = stubAnimate();

    const mutateAsync = vi.fn().mockImplementation(async () => {
      useTasksMock.mockReturnValue({
        data: {
          tasks: [openB, { ...openA, status: "COMPLETED" }],
          source: "remote",
        },
        isLoading: false,
      });
    });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync, isPending: false });

    const { rerender } = render(<TasksPage />);

    await userEvent.click(
      screen.getByRole("button", { name: toggleName("Revisar vitrina") }),
    );
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    rerender(<TasksPage />);

    // task-a travelled one row down (0px -> 72px): it starts lifted by -72px.
    await waitFor(() => {
      expect(animate).toHaveBeenCalled();
    });
    const movedDown = animate.mock.calls.find((call) =>
      JSON.stringify(call[0]).includes("translateY(-72px)"),
    );
    expect(movedDown).toBeTruthy();
    expect(movedDown![1]).toMatchObject({
      duration: 300,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  });

  it("skips the transform when the operator asked for reduced motion", async () => {
    stubReducedMotion(true);
    stubRowRects();
    const animate = stubAnimate();

    const mutateAsync = vi.fn().mockImplementation(async () => {
      useTasksMock.mockReturnValue({
        data: {
          tasks: [openB, { ...openA, status: "COMPLETED" }],
          source: "remote",
        },
        isLoading: false,
      });
    });
    useUpdateTaskStatusMock.mockReturnValue({ mutateAsync, isPending: false });

    const { container, rerender } = render(<TasksPage />);

    await userEvent.click(
      screen.getByRole("button", { name: toggleName("Revisar vitrina") }),
    );
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    rerender(<TasksPage />);

    await waitFor(() => {
      expect(taskOrder(container)).toEqual(["task-b", "task-a"]);
    });

    expect(animate).not.toHaveBeenCalled();
    // The state change still lands: only the travel is dropped.
    expect(struckTitles(container)).toEqual(["Revisar vitrina"]);
  });
});
