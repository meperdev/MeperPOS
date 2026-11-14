"use client";

import { useMemo, useState } from "react";
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
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  FilterBar,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
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
import { cn, formatDateTime, formatDate } from "@/lib/utils";
import type { TaskStatus } from "@/types";

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
      return "bg-amber-500";
    case "IN_PROGRESS":
      return "bg-sky-500";
    case "COMPLETED":
      return "bg-emerald-500";
    case "CANCELLED":
      return "bg-rose-500";
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
  const taskList = tasksQuery.data?.tasks ?? [];
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
    try {
      await updateTaskStatus.mutateAsync({ id: taskId, status: nextStatus });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar la tarea"));
    }
  };

  const handleSetTaskStatus = async (
    taskId: string,
    status: TaskStatus,
  ) => {
    try {
      await updateTaskStatus.mutateAsync({ id: taskId, status });
    } catch (error) {
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
        <CardSkeleton count={6} label="Cargando tareas del local..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 lg:space-y-5">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
                Tareas del local
              </h1>
              <span className="hidden sm:inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                {totalTasks} {totalTasks === 1 ? "tarea" : "tareas"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Gestión operativa del equipo y seguimiento de actividades
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>

        {/* Metrics KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 lg:gap-4">
          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Activas
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70 shrink-0" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {pendingTasks + inProgressTasks}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              {totalTasks} en total
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Pendientes
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {pendingTasks}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Por comenzar
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                En curso
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {inProgressTasks}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              En progreso
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Completadas
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {completedTasks}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Finalizadas
            </p>
          </div>
        </div>

        {/* Filter Toolbar */}
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Buscar tarea por título, descripción o responsable..."
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
                <BentoSelect
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-start">
          {/* Left Column: Task List (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <Card className="overflow-hidden border-border/70 bg-card shadow-2xs">
              <div className="border-b border-border/60 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs sm:text-sm font-semibold text-foreground">
                    Lista de tareas
                  </h3>
                  <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                    {filteredTasks.length}
                  </span>
                </div>

                <div className="sm:hidden flex items-center gap-1">
                  <BentoSelect
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
                  <div className="space-y-2">
                    {filteredTasks.map((task) => {
                      const isSelected = task.id === selectedTask?.id;
                      const isOverdue =
                        task.dueDate &&
                        task.status !== "COMPLETED" &&
                        task.status !== "CANCELLED" &&
                        new Date(task.dueDate) < new Date();

                      return (
                        <div
                          key={task.id}
                          onClick={() => {
                            setSelectedTaskId(task.id);
                            setIsEditingTask(false);
                          }}
                          className={cn(
                            "rounded-xl border p-3.5 transition-colors cursor-pointer select-none",
                            isSelected
                              ? "border-border bg-muted/40 shadow-2xs"
                              : "border-border/60 bg-background/40 hover:bg-muted/20 hover:border-border",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Fast Toggle Checkbox */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleTask(task.id, task.status);
                              }}
                              className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                              aria-label={`Cambiar estado rápido de ${task.title}`}
                            >
                              {task.status === "COMPLETED" ? (
                                <CheckSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>

                            {/* Task Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <span
                                  className={cn(
                                    "text-xs sm:text-sm font-semibold transition-colors line-clamp-1",
                                    task.status === "COMPLETED"
                                      ? "text-muted-foreground line-through decoration-muted-foreground/60"
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
                                <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
                                  {task.description}
                                </p>
                              )}

                              {/* Metadata row */}
                              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
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
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-medium border tabular-nums",
                                      isOverdue
                                        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                                        : "bg-muted/50 text-muted-foreground border-border/60",
                                    )}
                                  >
                                    <Calendar className="h-3 w-3" />
                                    {formatDate(task.dueDate)}
                                    {isOverdue && " (Vencida)"}
                                  </span>
                                )}

                                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground tabular-nums ml-auto">
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
          <div className="lg:col-span-5 lg:sticky lg:top-4">
            {selectedTask ? (
              <Card className="border-border/70 bg-card overflow-hidden shadow-2xs flex flex-col lg:max-h-[calc(100vh-6.5rem)]">
                {/* Header & Quick Action Buttons */}
                <div className="border-b border-border/60 p-4 shrink-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-muted-foreground">
                        Detalle de la tarea
                      </span>
                      <h2 className="text-sm sm:text-base font-semibold text-foreground mt-0.5 truncate">
                        {selectedTask.title}
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selectedTask.createdBy?.name
                          ? `Creada por ${selectedTask.createdBy.name}`
                          : "Creada desde el dashboard"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
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
                            disabled={updateTask.isPending}
                          >
                            {updateTask.isPending ? "Guardando" : "Guardar cambios"}
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
                    <span className="text-xs font-medium text-muted-foreground block mb-1.5">
                      Estado actual
                    </span>
                    <div className="flex flex-wrap gap-1.5">
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
                                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer disabled:cursor-default",
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
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          Título de la tarea
                        </label>
                        <input
                          value={taskDraft.title}
                          onChange={(e) =>
                            setTaskDraft((prev) => ({ ...prev, title: e.target.value }))
                          }
                          maxLength={120}
                          className="h-[38px] w-full rounded-lg border border-border/70 bg-card px-3 text-xs sm:text-sm text-foreground focus:border-border focus:outline-none transition-colors"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          Descripción o notas
                        </label>
                        <textarea
                          value={taskDraft.description}
                          onChange={(e) =>
                            setTaskDraft((prev) => ({ ...prev, description: e.target.value }))
                          }
                          rows={3}
                          maxLength={500}
                          placeholder="Detalles e instrucciones para el equipo..."
                          className="w-full rounded-lg border border-border/70 bg-card px-3 py-2 text-xs sm:text-sm text-foreground focus:border-border focus:outline-none resize-none transition-colors"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <BentoSelect
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

                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            Fecha límite
                          </label>
                          <input
                            type="date"
                            value={taskDraft.dueDate ?? ""}
                            onChange={(e) =>
                              setTaskDraft((prev) => ({
                                ...prev,
                                dueDate: e.target.value || null,
                              }))
                            }
                            className="h-[38px] w-full rounded-lg border border-border/70 bg-card px-3 font-mono text-xs text-foreground tabular-nums focus:border-border focus:outline-none transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">
                          Descripción
                        </span>
                        <p className="text-xs text-foreground leading-relaxed bg-card p-3 rounded-lg border border-border/60 max-h-24 overflow-y-auto">
                          {selectedTask.description?.trim() || "Sin descripción adicional por ahora."}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <div className="p-2.5 rounded-lg bg-card border border-border/60 min-w-0">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <UserIcon className="h-3.5 w-3.5 shrink-0" />
                            <span>Asignado</span>
                          </span>
                          <span className="font-semibold text-foreground text-xs truncate block mt-1">
                            {selectedTask.assignedTo?.name ?? "Sin asignar"}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-lg bg-card border border-border/60 min-w-0">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5 shrink-0" />
                            <span>Fecha límite</span>
                          </span>
                          <span className="font-mono font-semibold text-foreground text-xs tabular-nums truncate block mt-1">
                            {selectedTask.dueDate ? formatDate(selectedTask.dueDate) : "Sin fecha"}
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
                      <h3 className="text-xs font-semibold text-foreground">
                        Historial
                      </h3>
                      <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                        {selectedTaskTimeline.length}
                      </span>
                    </div>
                    {isTimelineLoading && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {selectedTaskTimeline.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-center text-xs text-muted-foreground">
                      Todavía no hay eventos registrados para esta tarea.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {selectedTaskTimeline.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs"
                        >
                          <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-foreground text-xs truncate">
                                {getTaskEventLabel(event.type)}
                                {event.fromStatus && event.fromStatus !== event.toStatus && (
                                  <span className="ml-1.5 font-normal text-muted-foreground">
                                    ({getTaskStatusLabel(event.fromStatus)} → {getTaskStatusLabel(event.toStatus)})
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0">
                                {formatDateTime(event.createdAt)}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
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
                <h4 className="text-xs sm:text-sm font-semibold text-foreground">
                  Ninguna tarea seleccionada
                </h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                  Haz clic en una tarea de la lista para ver sus detalles, editarla o consultar su historial de cambios.
                </p>
              </Card>
            )}
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
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Título <span className="text-rose-500">*</span>
            </label>
            <input
              required
              value={newModalDraft.title}
              onChange={(e) => setNewModalDraft((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Ej: Revisar stock de vitrina..."
              maxLength={120}
              className="h-[38px] w-full rounded-lg border border-border/70 bg-muted/30 px-3 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-border focus:bg-background focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Descripción o instrucciones
            </label>
            <textarea
              value={newModalDraft.description}
              onChange={(e) =>
                setNewModalDraft((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
              maxLength={500}
              placeholder="Detalla qué necesita hacerse y cualquier consideración especial..."
              className="w-full rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-border focus:bg-background focus:outline-none resize-none transition-colors"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <BentoSelect
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

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Fecha límite
              </label>
              <input
                type="date"
                value={newModalDraft.dueDate}
                onChange={(e) =>
                  setNewModalDraft((prev) => ({ ...prev, dueDate: e.target.value }))
                }
                className="h-[38px] w-full rounded-lg border border-border/70 bg-muted/30 px-3 font-mono text-xs text-foreground tabular-nums focus:border-border focus:bg-background focus:outline-none transition-colors"
              />
            </div>
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
              disabled={createTask.isPending || !newModalDraft.title.trim()}
            >
              {createTask.isPending ? "Creando..." : "Crear tarea"}
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
