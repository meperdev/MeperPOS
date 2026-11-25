"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useCreateTask,
  useDeleteTask,
  useTaskAssignees,
  useTaskTimeline,
  useTasks,
  useUpdateTask,
  useUpdateTaskStatus,
} from "@/hooks/useTasks";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  FilterBar,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { COLLECTION_CONTENT_ENTER_CLASSES } from "@/components/ui/collectionGrid";
import { useDeferredLoading } from "@/hooks/useDeferredLoading";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  ClipboardList,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Clock3,
  Calendar,
  User as UserIcon,
  Users,
  Loader2,
  Edit3,
} from "lucide-react";
import { cn, formatDateShort, formatDateTime } from "@/lib/utils";
import type { TaskStatus } from "@/types";
import { isTaskOverdue } from "./task-due";

function getTaskStatusLabel(status: TaskStatus) {
  switch (status) {
    case "PENDING":
      return "Pendiente";
    case "IN_PROGRESS":
      return "En curso";
    case "COMPLETED":
      return "Completada";
    case "CANCELLED":
      return "Cancelada";
  }
}

function getTaskStatusVariant(
  status: TaskStatus,
): "warning" | "primary" | "success" | "danger" {
  switch (status) {
    case "PENDING":
      return "warning";
    case "IN_PROGRESS":
      return "primary";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "danger";
  }
}
function getTaskStatusDotClass(status: TaskStatus) {
  switch (status) {
    case "PENDING":
      return "bg-warning";
    case "IN_PROGRESS":
      return "bg-info";
    case "COMPLETED":
      return "bg-success";
    case "CANCELLED":
      return "bg-danger";
  }
}

function getTaskEventLabel(type: "CREATED" | "UPDATED" | "STATUS_CHANGED" | "DELETED") {
  switch (type) {
    case "CREATED":
      return "Creada";
    case "UPDATED":
      return "Actualizada";
    case "STATUS_CHANGED":
      return "Cambio de estado";
    case "DELETED":
      return "Eliminada";
  }
}

/** Strike-through draw time. The row holds its place until the line lands. */
const STRIKE_MS = 250;
/** Row travel time for the reorder. */
const MOVE_MS = 300;
/** Rectangles of every rendered row, taken before the reorder commits. */
type FlipSnapshot = {
  rects: Map<string, DOMRect>;
  /** Row that owned the focused checkbox, when the toggle came from the keyboard. */
  focusTaskId: string | null;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function TasksPage() {
  const toast = useToast();
  const { user: currentUser } = useAuth();

  // Filters & Scope
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TaskStatus>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>("ALL");

  // Selection & Forms
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingDeletedTaskIds, setPendingDeletedTaskIds] = useState<string[]>([]);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    description: "",
    assignedToId: "" as string | null,
    dueDate: "" as string | null,
  });

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [newModalDraft, setNewModalDraft] = useState({
    title: "",
    description: "",
    assignedToId: "",
    dueDate: "",
  });

  // Queries & Mutations
  const tasksQuery = useTasks();
  // Only the first load paints a skeleton, and only after a short grace period.
  const showSkeleton = useDeferredLoading(tasksQuery.isLoading);
  const taskList = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const assigneesQuery = useTaskAssignees();
  const assignees = assigneesQuery.data ?? [];

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const updateTaskStatus = useUpdateTaskStatus();
  const deleteTask = useDeleteTask();

  const visibleTaskList = taskList.filter((task) => !pendingDeletedTaskIds.includes(task.id));

  // Filtered List
  const filteredTasks = useMemo(() => {
    return visibleTaskList.filter((task) => {
      // Scope filter
      if (scope === "mine") {
        const isMine =
          task.createdById === currentUser?.id || task.assignedToId === currentUser?.id;
        if (!isMine) return false;
      }

      // Status filter
      if (statusFilter !== "ALL" && task.status !== statusFilter) {
        return false;
      }

      // Assignee filter
      if (selectedAssigneeId !== "ALL") {
        if (selectedAssigneeId === "UNASSIGNED") {
          if (task.assignedToId) return false;
        } else if (task.assignedToId !== selectedAssigneeId) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = task.title.toLowerCase().includes(q);
        const matchDesc = task.description?.toLowerCase().includes(q);
        const matchAssignee = task.assignedTo?.name.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchAssignee) return false;
      }

      return true;
    });
  }, [visibleTaskList, scope, statusFilter, selectedAssigneeId, searchQuery, currentUser?.id]);

  /*
   * Completion motion, first half: a row that just completed keeps the slot it
   * had in the last committed order while its strike-through draws. Holding it
   * in an effect would be too late — the commit that paints the strike is also
   * the commit that would move the row, and moving a node re-inserts it, which
   * drops the CSS transition on the floor.
   *
   * The snapshots are state, not refs: they are read while rendering, and the
   * render-phase updates below are the documented "adjust state when props
   * change" pattern, which re-renders before anything is committed.
   */
  const [orderSnapshot, setOrderSnapshot] = useState<string[]>([]);
  const [statusSnapshot, setStatusSnapshot] = useState<Record<string, TaskStatus>>({});
  const [holdSlots, setHoldSlots] = useState<Record<string, number>>({});
  const releaseTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFlip = useRef<FlipSnapshot | null>(null);
  const previousOrderKey = useRef<string | null>(null);
  const isMounted = useRef(true);

  const nextStatuses: Record<string, TaskStatus> = {};
  for (const task of visibleTaskList) {
    nextStatuses[task.id] = task.status;
  }

  const statusesChanged =
    Object.keys(nextStatuses).length !== Object.keys(statusSnapshot).length ||
    Object.keys(nextStatuses).some((id) => statusSnapshot[id] !== nextStatuses[id]);

  const newlyCompleted = statusesChanged
    ? visibleTaskList.filter(
        (task) =>
          task.status === "COMPLETED" &&
          statusSnapshot[task.id] !== undefined &&
          statusSnapshot[task.id] !== "COMPLETED" &&
          holdSlots[task.id] === undefined,
      )
    : [];

  if (newlyCompleted.length > 0) {
    setHoldSlots((current) => {
      const next = { ...current };
      for (const task of newlyCompleted) {
        const index = orderSnapshot.indexOf(task.id);
        if (index >= 0) next[task.id] = index;
      }
      return next;
    });
  }

  if (statusesChanged) setStatusSnapshot(nextStatuses);

  /**
   * Completed rows sink to the end of the open list; everything still open
   * keeps the order the server sent (`sort` is stable). Held rows are re-seated
   * at the index they had before the status changed, so nothing jumps while
   * its strike is still drawing.
   */
  const orderedTasks = useMemo(() => {
    const statusById = new Map(filteredTasks.map((task) => [task.id, task.status]));
    const rankOf = (id: string) =>
      statusById.get(id) === "COMPLETED" && holdSlots[id] === undefined ? 1 : 0;

    const orderedIds = filteredTasks
      .map((task) => task.id)
      .sort((a, b) => rankOf(a) - rankOf(b));

    for (const [id, index] of Object.entries(holdSlots)) {
      const from = orderedIds.indexOf(id);
      if (from < 0) continue;
      orderedIds.splice(from, 1);
      orderedIds.splice(Math.min(index, orderedIds.length), 0, id);
    }

    const byId = new Map(filteredTasks.map((task) => [task.id, task]));
    return orderedIds.flatMap((id) => {
      const task = byId.get(id);
      return task ? [task] : [];
    });
  }, [filteredTasks, holdSlots]);

  const renderedOrder = orderedTasks.map((task) => task.id);
  const taskOrderKey = renderedOrder.join("|");

  // Remember the order that actually reached the screen: it is the reference
  // slot for the next row that completes. Same render-phase sync pattern, so
  // the snapshot is current before anything is committed.
  const orderUnchanged =
    renderedOrder.length === orderSnapshot.length &&
    renderedOrder.every((id, index) => id === orderSnapshot[index]);
  if (!orderUnchanged) setOrderSnapshot(renderedOrder);

  // One timer per held row, released once its strike has drawn. Reduced motion
  // draws the line instantly, so the row may travel at once.
  useEffect(() => {
    const held = Object.keys(holdSlots);
    const holdMs = prefersReducedMotion() ? 0 : STRIKE_MS;

    for (const id of held) {
      if (releaseTimers.current.has(id)) continue;

      releaseTimers.current.set(
        id,
        setTimeout(() => {
          releaseTimers.current.delete(id);
          if (!isMounted.current) return;
          setHoldSlots((current) => {
            if (current[id] === undefined) return current;
            const next = { ...current };
            delete next[id];
            return next;
          });
        }, holdMs),
      );
    }

    for (const [id, timer] of releaseTimers.current) {
      if (held.includes(id)) continue;
      clearTimeout(timer);
      releaseTimers.current.delete(id);
    }
  }, [holdSlots]);

  useEffect(() => {
    isMounted.current = true;
    const timers = releaseTimers.current;
    return () => {
      isMounted.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Completion motion, second half (FLIP): the "before" rectangles are captured
  // at the click and the "after" ones by the layout effect that runs on the
  // render which finally reorders. The strike-through changes no layout, so both
  // measurements describe the same rows.
  const captureRowRects = () => {
    const rects = new Map<string, DOMRect>();
    rowRefs.current.forEach((element, id) => {
      rects.set(id, element.getBoundingClientRect());
    });
    return rects;
  };

  useLayoutEffect(() => {
    const orderChanged =
      previousOrderKey.current !== null && previousOrderKey.current !== taskOrderKey;
    previousOrderKey.current = taskOrderKey;

    const pending = pendingFlip.current;
    if (!pending || !orderChanged) return;
    pendingFlip.current = null;

    if (!prefersReducedMotion()) {
      rowRefs.current.forEach((element, id) => {
        const before = pending.rects.get(id);
        if (!before) return;

        const delta = before.top - element.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) return;
        if (typeof element.animate !== "function") return;

        element.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }],
          { duration: MOVE_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
      });
    }

    // The row is the same keyed node in its new place, so focus usually rides
    // along; restore it explicitly when the move dropped it.
    if (pending.focusTaskId) {
      const toggle = rowRefs.current
        .get(pending.focusTaskId)
        ?.querySelector<HTMLButtonElement>("[data-task-toggle]");
      if (toggle && document.activeElement !== toggle) toggle.focus();
    }
  }, [taskOrderKey]);

  // Metrics
  const totalTasks = visibleTaskList.length;
  const pendingTasks = visibleTaskList.filter((t) => t.status === "PENDING").length;
  const inProgressTasks = visibleTaskList.filter((t) => t.status === "IN_PROGRESS").length;
  const completedTasks = visibleTaskList.filter((t) => t.status === "COMPLETED").length;
  const hasCompletedTasks = completedTasks > 0;

  // Resolved selection
  const resolvedSelectedTaskId = (() => {
    if (visibleTaskList.length === 0) {
      return null;
    }
    if (selectedTaskId && visibleTaskList.some((task) => task.id === selectedTaskId)) {
      return selectedTaskId;
    }
    return visibleTaskList[0].id;
  })();

  const selectedTask = visibleTaskList.find((task) => task.id === resolvedSelectedTaskId) ?? null;

  const {
    data: selectedTaskTimeline = [],
    isLoading: isTimelineLoading,
  } = useTaskTimeline(selectedTask?.id ?? "", {
    enabled: !!selectedTask,
  });

  const isTaskEditing = isEditingTask && !!selectedTask;

  const getNextSelectedTaskIdAfterRemoval = (removedTaskIds: string[]) => {
    if (!resolvedSelectedTaskId || removedTaskIds.length === 0) {
      return resolvedSelectedTaskId;
    }

    const removedTaskIdSet = new Set(removedTaskIds);
    if (!removedTaskIdSet.has(resolvedSelectedTaskId)) {
      return resolvedSelectedTaskId;
    }

    return visibleTaskList.find((task) => !removedTaskIdSet.has(task.id))?.id ?? null;
  };

  const handleToggleTask = async (
    taskId: string,
    currentStatus: TaskStatus,
  ) => {
    const nextStatus: TaskStatus = currentStatus === "COMPLETED" ? "PENDING" : "COMPLETED";
    const toggle = rowRefs.current
      .get(taskId)
      ?.querySelector<HTMLButtonElement>("[data-task-toggle]");

    pendingFlip.current = {
      rects: captureRowRects(),
      focusTaskId: toggle && document.activeElement === toggle ? taskId : null,
    };

    try {
      await updateTaskStatus.mutateAsync({ id: taskId, status: nextStatus });
    } catch (error) {
      // A rejected request leaves the row where it was: nothing to animate.
      pendingFlip.current = null;
      toast.error(getApiErrorMessage(error, "No se pudo actualizar la tarea"));
    }
  };

  const handleSetTaskStatus = async (
    taskId: string,
    status: TaskStatus,
  ) => {
    pendingFlip.current = {
      rects: captureRowRects(),
      focusTaskId: null,
    };

    try {
      await updateTaskStatus.mutateAsync({ id: taskId, status });
    } catch (error) {
      pendingFlip.current = null;
      toast.error(getApiErrorMessage(error, "No se pudo actualizar la tarea"));
    }
  };

  const handleCreateModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newModalDraft.title.trim();
    if (!trimmed) {
      toast.error("El título es obligatorio");
      return;
    }

    try {
      const created = await createTask.mutateAsync({
        title: trimmed,
        description: newModalDraft.description.trim() || undefined,
        assignedToId: newModalDraft.assignedToId || undefined,
        dueDate: newModalDraft.dueDate ? new Date(newModalDraft.dueDate).toISOString() : undefined,
      });
      setSelectedTaskId(created.id);
      setShowCreateModal(false);
      setNewModalDraft({ title: "", description: "", assignedToId: "", dueDate: "" });
      toast.success("Tarea creada exitosamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo crear la tarea"));
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const previousSelectedTaskId = resolvedSelectedTaskId;
    const nextSelectedTaskId = getNextSelectedTaskIdAfterRemoval([taskId]);

    setPendingDeletedTaskIds((current) =>
      current.includes(taskId) ? current : [...current, taskId],
    );

    if (nextSelectedTaskId !== resolvedSelectedTaskId) {
      setSelectedTaskId(nextSelectedTaskId);
      setIsEditingTask(false);
    }

    try {
      await deleteTask.mutateAsync(taskId);
      setPendingDeletedTaskIds((current) => current.filter((id) => id !== taskId));
      toast.success("Tarea eliminada");
    } catch (error) {
      setPendingDeletedTaskIds((current) => current.filter((id) => id !== taskId));
      if (nextSelectedTaskId !== previousSelectedTaskId) {
        setSelectedTaskId(previousSelectedTaskId);
      }
      toast.error(getApiErrorMessage(error, "No se pudo borrar la tarea"));
    }
  };

  const handleClearCompletedTasks = async () => {
    const completedIds = visibleTaskList
      .filter((task) => task.status === "COMPLETED")
      .map((task) => task.id);

    if (completedIds.length === 0) return;

    const previousSelectedTaskId = resolvedSelectedTaskId;
    const nextSelectedTaskId = getNextSelectedTaskIdAfterRemoval(completedIds);

    setPendingDeletedTaskIds((current) => [...new Set([...current, ...completedIds])]);

    if (nextSelectedTaskId !== resolvedSelectedTaskId) {
      setSelectedTaskId(nextSelectedTaskId);
      setIsEditingTask(false);
    }

    try {
      await Promise.all(completedIds.map((id) => deleteTask.mutateAsync(id)));
      setPendingDeletedTaskIds((current) =>
        current.filter((id) => !completedIds.includes(id)),
      );
      setShowDeleteAllModal(false);
      toast.success("Tareas completadas eliminadas");
    } catch (error) {
      setPendingDeletedTaskIds((current) => current.filter((id) => !completedIds.includes(id)));
      if (nextSelectedTaskId !== previousSelectedTaskId) {
        setSelectedTaskId(previousSelectedTaskId);
      }
      toast.error(getApiErrorMessage(error, "No se pudieron borrar las tareas"));
    }
  };

  const handleEditSelectedTask = () => {
    if (!selectedTask) return;

    setTaskDraft({
      title: selectedTask.title,
      description: selectedTask.description ?? "",
      assignedToId: selectedTask.assignedToId ?? "",
      dueDate: selectedTask.dueDate ? selectedTask.dueDate.substring(0, 10) : "",
    });
    setIsEditingTask(true);
  };

  const handleCancelTaskEdit = () => {
    if (!selectedTask) {
      setTaskDraft({ title: "", description: "", assignedToId: "", dueDate: "" });
      setIsEditingTask(false);
      return;
    }

    setTaskDraft({
      title: selectedTask.title,
      description: selectedTask.description ?? "",
      assignedToId: selectedTask.assignedToId ?? "",
      dueDate: selectedTask.dueDate ? selectedTask.dueDate.substring(0, 10) : "",
    });
    setIsEditingTask(false);
  };

  const handleSaveTaskEdit = async () => {
    if (!selectedTask) return;

    const trimmedTitle = taskDraft.title.trim();
    if (!trimmedTitle) {
      toast.error("La tarea necesita un título para guardarse.");
      return;
    }

    const data: {
      title: string;
      description: string | null;
      assignedToId?: string | null;
      dueDate?: string | null;
    } = {
      title: trimmedTitle,
      description: taskDraft.description.trim() || null,
    };

    if (taskDraft.assignedToId) {
      data.assignedToId = taskDraft.assignedToId;
    }
    if (taskDraft.dueDate) {
      data.dueDate = new Date(taskDraft.dueDate).toISOString();
    }

    try {
      await updateTask.mutateAsync({
        id: selectedTask.id,
        data,
      });
      setIsEditingTask(false);
      toast.success("Tarea actualizada");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo guardar la tarea"));
    }
  };

  if (tasksQuery.isLoading) {
    return (
      <DashboardLayout>
        {showSkeleton ? <CardSkeleton count={6} label="Cargando tareas del local…" /> : null}
      </DashboardLayout>
    );
  }

  if (tasksQuery.error && !tasksQuery.data) {
    return (
      <DashboardLayout>
        <ErrorState
          message={getApiErrorMessage(tasksQuery.error, "No se pudieron cargar las tareas")}
          onRetry={() => tasksQuery.refetch()}
          retryLabel="Reintentar"
          className="min-h-[240px]"
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className={cn("space-y-4 lg:space-y-5", COLLECTION_CONTENT_ENTER_CLASSES)}>
        <PageHeader
          title="Tareas del local"
          count={`${totalTasks} ${totalTasks === 1 ? "tarea" : "tareas"}`}
          subtitle="Gestión operativa del equipo y seguimiento de actividades"
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDeleteAllModal(true)}
                disabled={!hasCompletedTasks || deleteTask.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Borrar completadas
              </Button>
              <Button size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3.5 w-3.5" />
                Nueva tarea
              </Button>
            </>
          }
        />

        {/* Metrics KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:gap-4">
          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-muted-foreground">
                Activas
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70 shrink-0" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {pendingTasks + inProgressTasks}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
              {totalTasks} en total
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-muted-foreground">
                Pendientes
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {pendingTasks}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Por comenzar
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-muted-foreground">
                En curso
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-info shrink-0" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {inProgressTasks}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              En progreso
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-muted-foreground">
                Completadas
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {completedTasks}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Finalizadas
            </p>
          </div>
        </div>

        {/* Filter Toolbar */}
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Buscar tarea por título, descripción o responsable…"
          filterControls={
            <>
              <FilterGroup>
                <FilterOptionButton
                  active={scope === "all"}
                  onClick={() => setScope("all")}
                  className="inline-flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Equipo</span>
                </FilterOptionButton>
                <FilterOptionButton
                  active={scope === "mine"}
                  onClick={() => setScope("mine")}
                  className="inline-flex items-center gap-1.5"
                >
                  <UserIcon className="w-3.5 h-3.5" />
                  <span>Mis tareas</span>
                </FilterOptionButton>
              </FilterGroup>

              <FilterGroup label="Estado" className="hidden sm:inline-flex">
                {(["ALL", "PENDING", "IN_PROGRESS", "COMPLETED"] as const).map(
                  (st) => (
                    <FilterOptionButton
                      key={st}
                      active={statusFilter === st}
                      onClick={() => setStatusFilter(st)}
                    >
                      {st === "ALL" ? "Todas" : getTaskStatusLabel(st)}
                    </FilterOptionButton>
                  ),
                )}
              </FilterGroup>

              {assignees.length > 1 && (
                <Select
                  value={selectedAssigneeId}
                  onChange={setSelectedAssigneeId}
                  className="w-full sm:w-44"
                  options={[
                    { value: "ALL", label: "Todo el personal" },
                    { value: "UNASSIGNED", label: "Sin asignar" },
                    ...assignees.map((a) => ({
                      value: a.id,
                      label: a.name,
                    })),
                  ]}
                />
              )}

            </>
          }
        />

        {/* Main Content: Split Master-Detail */}
        {/* @container sits on the parent: a container query never matches its own element. */}
        <div className="@container">
        <div className="grid grid-cols-1 @5xl:grid-cols-12 gap-4 lg:gap-5 items-start">
          {/* Left Column: Task List (7 cols) */}
          <div className="@5xl:col-span-7 space-y-4">
            <Card className="overflow-hidden border-border/70 bg-card shadow-2xs">
              <div className="border-b border-border/60 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Lista de tareas
                  </h3>
                  <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                    {filteredTasks.length}
                  </span>
                </div>

                <div className="sm:hidden flex items-center gap-1">
                  <Select
                    value={statusFilter}
                    onChange={(val) =>
                      setStatusFilter(val as "ALL" | TaskStatus)
                    }
                    className="w-36"
                    options={[
                      { value: "ALL", label: "Todas" },
                      { value: "PENDING", label: "Pendientes" },
                      { value: "IN_PROGRESS", label: "En curso" },
                      { value: "COMPLETED", label: "Completadas" },
                    ]}
                  />
                </div>
              </div>

              <div className="p-3">
                {filteredTasks.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardList className="h-5 w-5 text-muted-foreground" />}
                    title={
                      searchQuery || statusFilter !== "ALL" || scope === "mine"
                        ? "No se encontraron tareas con los filtros aplicados"
                        : "No hay tareas creadas aún"
                    }
                    subtitle={
                      searchQuery || statusFilter !== "ALL"
                        ? "Prueba cambiando o limpiando los filtros de búsqueda."
                        : "Comienza agregando una tarea para organizar las actividades del local."
                    }
                  />
                ) : (
                  <div className="space-y-1">
                    {orderedTasks.map((task) => {
                      const isSelected = task.id === selectedTask?.id;
                      const isOverdue =
                        task.dueDate &&
                        task.status !== "COMPLETED" &&
                        task.status !== "CANCELLED" &&
                        isTaskOverdue(task.dueDate);

                      return (
                        <div
                          key={task.id}
                          data-task-id={task.id}
                          ref={(element) => {
                            if (element) rowRefs.current.set(task.id, element);
                            else rowRefs.current.delete(task.id);
                          }}
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            setIsEditingTask(false);
                          }}
                          className={cn(
                            "rounded-lg p-3.5 transition-colors cursor-pointer select-none",
                            isSelected
                              ? "bg-muted/60"
                              : "hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Fast Toggle Checkbox */}
                            <button
                              type="button"
                              data-task-toggle=""
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleTask(task.id, task.status);
                              }}
                              className="-ml-2 -mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                              aria-label={`Cambiar estado rápido de ${task.title}`}
                            >
                              {task.status === "COMPLETED" ? (
                                <CheckSquare className="h-4 w-4 text-success-text" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>

                            {/* Task Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <span
                                  data-struck={task.status === "COMPLETED"}
                                  className={cn(
                                    "task-title-strike line-clamp-1 text-sm font-semibold",
                                    task.status === "COMPLETED"
                                      ? "text-muted-foreground"
                                      : "text-foreground",
                                  )}
                                >
                                  {task.title}
                                </span>
                                <Badge
                                  variant={getTaskStatusVariant(task.status)}
                                  dot
                                  className="shrink-0"
                                >
                                  {getTaskStatusLabel(task.status)}
                                </Badge>
                              </div>

                              {task.description && (
                                <p className="mt-1 text-[13px] text-muted-foreground line-clamp-1">
                                  {task.description}
                                </p>
                              )}

                              {/* Metadata row */}
                              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                                {task.assignedTo ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-0.5 font-medium text-foreground border border-border/60">
                                    <UserIcon className="h-3 w-3 text-muted-foreground" />
                                    {task.assignedTo.name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/30 px-1.5 py-0.5 text-muted-foreground">
                                    <Users className="h-3 w-3" />
                                    Sin asignar
                                  </span>
                                )}

                                {task.dueDate && (
                                  <Badge
                                    variant={isOverdue ? "danger" : "default"}
                                    className="gap-1 px-2 text-xs font-medium"
                                  >
                                    <Calendar className="h-3 w-3" />
                                    {formatDateShort(task.dueDate)}
                                    {isOverdue && " (Vencida)"}
                                  </Badge>
                                )}

                                <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground ml-auto">
                                  <Clock3 className="h-3 w-3" />
                                  {formatDateTime(task.updatedAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Selected Task Inspector & Timeline (5 cols) */}
          <div className="@5xl:col-span-5 @5xl:sticky @5xl:top-4">
            {selectedTask ? (
              <Card className="@container border-border/70 bg-card overflow-hidden shadow-2xs flex flex-col @5xl:max-h-[calc(100vh-6.5rem)]">
                {/* Header & Quick Action Buttons */}
                <div className="border-b border-border/60 p-4 shrink-0">
                  <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-semibold text-foreground break-words">
                        {selectedTask.title}
                      </h2>
                      <p className="text-[13px] text-muted-foreground mt-0.5">
                        {selectedTask.createdBy?.name
                          ? `Creada por ${selectedTask.createdBy.name}`
                          : "Creada desde el panel"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isTaskEditing ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCancelTaskEdit}
                            disabled={updateTask.isPending}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveTaskEdit}
                            loading={updateTask.isPending}
                          >
                            {updateTask.isPending ? "Guardando…" : "Guardar cambios"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleEditSelectedTask}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteTask(selectedTask.id)}
                            disabled={deleteTask.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status Transition Quick Selectors */}
                  <div className="mt-3.5 pt-3 border-t border-border/50">
                    <span className="text-[13px] font-medium text-muted-foreground block mb-1.5">
                      Estado actual
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map(
                        (status) => {
                          const isCurrent = selectedTask.status === status;
                          return (
                            <button
                              key={status}
                              type="button"
                              onClick={() => handleSetTaskStatus(selectedTask.id, status)}
                              disabled={updateTaskStatus.isPending || isCurrent}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                                isCurrent
                                  ? "border-border bg-muted/70 text-foreground font-semibold shadow-2xs"
                                  : "border-border/60 bg-background/50 text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full shrink-0",
                                  getTaskStatusDotClass(status),
                                )}
                              />
                              {getTaskStatusLabel(status)}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                </div>

                {/* Task Details Content / Form */}
                <div className="p-4 border-b border-border/60 bg-muted/10 shrink-0">
                  {isTaskEditing ? (
                    <div className="space-y-3">
                      <Input
                        id="task-edit-title"
                        label="Título de la tarea"
                        value={taskDraft.title}
                        onChange={(e) =>
                          setTaskDraft((prev) => ({ ...prev, title: e.target.value }))
                        }
                        maxLength={120}
                      />

                      <Input
                        id="task-edit-description"
                        textarea
                        label="Descripción o notas"
                        value={taskDraft.description}
                        onChange={(e) =>
                          setTaskDraft((prev) => ({ ...prev, description: e.target.value }))
                        }
                        rows={3}
                        maxLength={500}
                        placeholder="Detalles e instrucciones para el equipo…"
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Select
                          label="Asignar a"
                          value={taskDraft.assignedToId ?? ""}
                          onChange={(val) =>
                            setTaskDraft((prev) => ({
                              ...prev,
                              assignedToId: val || null,
                            }))
                          }
                          options={[
                            { value: "", label: "Sin asignar" },
                            ...assignees.map((a) => ({
                              value: a.id,
                              label: `${a.name} (${a.role})`,
                            })),
                          ]}
                        />

                        <Input
                          id="task-edit-due-date"
                          type="date"
                          label="Fecha límite"
                          value={taskDraft.dueDate ?? ""}
                          onChange={(e) =>
                            setTaskDraft((prev) => ({
                              ...prev,
                              dueDate: e.target.value || null,
                            }))
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <span className="text-[13px] font-medium text-muted-foreground block mb-1">
                          Descripción
                        </span>
                        <p className="text-[13px] text-foreground leading-relaxed bg-muted/40 p-3 rounded-lg max-h-24 overflow-y-auto">
                          {selectedTask.description?.trim() || "Sin descripción adicional por ahora."}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[13px]">
                        <div className="p-2.5 rounded-lg bg-muted/40 min-w-0">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                            <UserIcon className="h-3.5 w-3.5 shrink-0" />
                            <span>Asignado</span>
                          </span>
                          <span className="font-semibold text-foreground text-[13px] truncate block mt-1">
                            {selectedTask.assignedTo?.name ?? "Sin asignar"}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-muted/40 min-w-0">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5 shrink-0" />
                            <span>Fecha límite</span>
                          </span>
                          <span className="font-semibold text-foreground text-[13px] truncate block mt-1">
                            {selectedTask.dueDate ? formatDateShort(selectedTask.dueDate) : "Sin fecha"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Timeline / Historial Section */}
                <div className="flex flex-1 min-h-0 flex-col p-4">
                  <div className="flex items-center justify-between mb-2.5 shrink-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        Historial
                      </h3>
                      <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                        {selectedTaskTimeline.length}
                      </span>
                    </div>
                    {isTimelineLoading && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {selectedTaskTimeline.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-center text-[13px] text-muted-foreground">
                      Todavía no hay eventos registrados para esta tarea.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto overflow-x-hidden pr-1">
                      {selectedTaskTimeline.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[13px]"
                        >
                          <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <div className="min-w-0 flex flex-wrap items-baseline gap-x-1.5">
                                <span className="whitespace-nowrap break-words font-semibold text-foreground text-[13px]">
                                  {getTaskEventLabel(event.type)}
                                </span>
                                {event.fromStatus && event.fromStatus !== event.toStatus && (
                                  <span className="min-w-0 break-words font-normal text-[13px] text-muted-foreground">
                                    ({getTaskStatusLabel(event.fromStatus)} → {getTaskStatusLabel(event.toStatus)})
                                  </span>
                                )}
                              </div>
                              <span className="whitespace-nowrap text-[13px] text-muted-foreground">
                                {formatDateTime(event.createdAt)}
                              </span>
                            </div>
                            <p className="text-[13px] text-muted-foreground truncate">
                              {event.createdBy?.name ?? "Sistema"}
                              {event.note ? ` - ${event.note}` : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <Card className="p-10 text-center border-dashed border-border/70 bg-card/40">
                <div className="w-10 h-10 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center mx-auto mb-2.5 text-muted-foreground">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">
                  Ninguna tarea seleccionada
                </h4>
                <p className="text-[13px] text-muted-foreground mt-1 max-w-xs mx-auto">
                  Haz clic en una tarea de la lista para ver sus detalles, editarla o consultar su historial de cambios.
                </p>
              </Card>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Create Task Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nueva tarea"
        size="md"
      >
        <form onSubmit={handleCreateModalSubmit} className="space-y-4">
          <Input
            id="task-create-title"
            label="Título"
            required
            value={newModalDraft.title}
            onChange={(e) => setNewModalDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Ej: Revisar stock de vitrina…"
            maxLength={120}
          />

          <Input
            id="task-create-description"
            textarea
            label="Descripción o instrucciones"
            value={newModalDraft.description}
            onChange={(e) =>
              setNewModalDraft((prev) => ({ ...prev, description: e.target.value }))
            }
            rows={3}
            maxLength={500}
            placeholder="Detalla qué necesita hacerse y cualquier consideración especial…"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Select
              label="Asignar a compañero"
              value={newModalDraft.assignedToId}
              onChange={(val) =>
                setNewModalDraft((prev) => ({ ...prev, assignedToId: val }))
              }
              options={[
                { value: "", label: "Sin asignar (general)" },
                ...assignees.map((a) => ({
                  value: a.id,
                  label: `${a.name} (${a.role})`,
                })),
              ]}
            />

            <Input
              id="task-create-due-date"
              type="date"
              label="Fecha límite"
              value={newModalDraft.dueDate}
              onChange={(e) =>
                setNewModalDraft((prev) => ({ ...prev, dueDate: e.target.value }))
              }
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/60">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createTask.isPending}
              disabled={!newModalDraft.title.trim()}
            >
              {createTask.isPending ? "Creando…" : "Crear tarea"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete All Completed Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteAllModal}
        onClose={() => setShowDeleteAllModal(false)}
        onConfirm={handleClearCompletedTasks}
        title="Borrar tareas completadas"
        message={`Se eliminarán ${completedTasks} tarea${completedTasks !== 1 ? "s" : ""} completada${completedTasks !== 1 ? "s" : ""}. Esta acción no se puede deshacer.`}
        confirmText="Borrar todas"
        cancelText="Cancelar"
      />
    </DashboardLayout>
  );
}
