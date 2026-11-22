"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Check,
  FolderOpen,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { InlineConfirmButton } from "@/components/ui/InlineConfirmButton";
import { CATEGORY_CHART_PALETTE } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { hasAnyRole } from "@/lib/auth";
import {
  useCreateExpenseGroup,
  useCreateExpenseLabel,
  useDeleteExpenseGroup,
  useDeleteExpenseLabel,
  useExpenseGroups,
  useUpdateExpenseGroup,
  useUpdateExpenseLabel,
} from "@/hooks/useExpenses";
import { getApiErrorMessage } from "@/lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type EditingTarget =
  | { kind: "group"; id: string; value: string }
  | { kind: "label"; id: string; groupId: string; value: string };

/**
 * Two-panel master-detail dialog for managing expense groups and their labels:
 * keeps one group list and one active label workspace without nested cards or
 * repeated per-card inputs.
 */
export function ExpenseTaxonomyModal({ isOpen, onClose }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const {
    data: groups = [],
    isLoading = false,
    isError = false,
    refetch,
  } = useExpenseGroups();
  const createGroup = useCreateExpenseGroup();
  const updateGroup = useUpdateExpenseGroup();
  const deleteGroup = useDeleteExpenseGroup();
  const createLabel = useCreateExpenseLabel();
  const updateLabel = useUpdateExpenseLabel();
  const deleteLabel = useDeleteExpenseLabel();

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"groups" | "labels">("groups");
  const [newGroupName, setNewGroupName] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [editing, setEditing] = useState<EditingTarget | null>(null);

  if (!hasAnyRole(user?.role, ["ADMIN"])) return null;

  const selectedIndex = groups.findIndex((group) => group.id === selectedGroupId);
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const activeGroup = groups[resolvedIndex] ?? null;
  const activeLabels = activeGroup
    ? (activeGroup.labels ?? []).filter((label) => label.active !== false)
    : [];

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, "No se pudo actualizar la taxonomía"),
      );
    }
  };

  const handleCreateGroup = () => {
    const trimmed = newGroupName.trim();
    if (!trimmed || createGroup.isPending) return;
    void run(async () => {
      const created = await createGroup.mutateAsync({ name: trimmed });
      setNewGroupName("");
      if (created?.id) {
        setSelectedGroupId(created.id);
        setMobilePane("labels");
      }
    }, "Grupo creado");
  };

  const handleCreateLabel = (groupId: string) => {
    const trimmed = newLabelName.trim();
    if (!trimmed || createLabel.isPending) return;
    void run(async () => {
      await createLabel.mutateAsync({
        groupId,
        data: { name: trimmed },
      });
      setNewLabelName("");
    }, "Etiqueta creada");
  };

  const handleSaveGroupEdit = (groupId: string) => {
    if (!editing || editing.kind !== "group" || editing.id !== groupId) return;
    const trimmed = editing.value.trim();
    if (!trimmed || updateGroup.isPending) return;
    void run(async () => {
      await updateGroup.mutateAsync({
        id: groupId,
        data: { name: trimmed },
      });
      setEditing(null);
    }, "Grupo actualizado");
  };

  const handleSaveLabelEdit = (groupId: string, labelId: string) => {
    if (!editing || editing.kind !== "label" || editing.id !== labelId) return;
    const trimmed = editing.value.trim();
    if (!trimmed || updateLabel.isPending) return;
    void run(async () => {
      await updateLabel.mutateAsync({
        groupId,
        id: labelId,
        data: { name: trimmed },
      });
      setEditing(null);
    }, "Etiqueta actualizada");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gestionar categorías"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {groups.length} {groups.length === 1 ? "grupo activo" : "grupos activos"}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Listo
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Cargando grupos…
        </div>
      ) : isError ? (
        <ErrorState
          title="No se pudieron cargar las categorías"
          message="Revisa tu conexión e intenta de nuevo."
          retryLabel="Reintentar"
          onRetry={refetch ? () => void refetch() : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border/70 bg-card md:h-[460px] md:grid-cols-[260px_1fr]">
          {/* Left rail: groups */}
          <div
            className={cn(
              "flex min-h-0 flex-col border-border/60 bg-muted/15 md:border-r",
              mobilePane === "labels" && activeGroup && "hidden md:flex",
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3.5 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                Grupos
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {groups.length}
              </span>
            </div>

            <div className="scrollbar-app max-h-[300px] min-h-0 flex-1 space-y-1 overflow-y-auto p-2 md:max-h-none">
              {groups.length === 0 ? (
                <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">
                  Sin grupos configurados.
                </p>
              ) : (
                groups.map((group, index) => {
                  const labelCount = (group.labels ?? []).filter(
                    (label) => label.active !== false,
                  ).length;
                  const isSelected = activeGroup?.id === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setMobilePane("labels");
                        setEditing(null);
                        setNewLabelName("");
                      }}
                      className={cn(
                        "flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-[13px] transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        isSelected
                          ? "border-border/80 bg-card font-medium text-foreground shadow-2xs"
                          : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORY_CHART_PALETTE[index % CATEGORY_CHART_PALETTE.length],
                          }}
                        />
                        <span className="truncate">{group.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {labelCount}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleCreateGroup();
              }}
              className="flex shrink-0 items-center gap-1.5 border-t border-border/60 p-2.5"
            >
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Nuevo grupo"
                  placeholder="Nuevo grupo…"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                aria-label="Crear grupo"
                loading={createGroup.isPending}
                disabled={!newGroupName.trim()}
                className="h-10 w-10 shrink-0 px-0 sm:h-9 sm:w-9"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </div>

          {/* Right workspace: active group and its labels */}
          <div
            className={cn(
              "flex min-h-0 flex-col bg-card",
              (!activeGroup || mobilePane === "groups") && "hidden md:flex",
            )}
          >
            {!activeGroup ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                  icon={<FolderOpen className="h-5 w-5" />}
                  title="Sin grupos todavía"
                  subtitle="Crea tu primer grupo a la izquierda para organizar las etiquetas."
                />
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-center border-b border-border/60 px-3 py-2 md:hidden">
                  <button
                    type="button"
                    onClick={() => setMobilePane("groups")}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Grupos
                  </button>
                </div>

                {/* Active group header */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                  {editing?.kind === "group" && editing.id === activeGroup.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleSaveGroupEdit(activeGroup.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label={`Renombrar ${activeGroup.name}`}
                          autoFocus
                          value={editing.value}
                          onChange={(event) =>
                            setEditing({ ...editing, value: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setEditing(null);
                            }
                          }}
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        loading={updateGroup.isPending}
                        disabled={!editing.value.trim()}
                        aria-label="Guardar nombre del grupo"
                        className="h-9 w-9 shrink-0 px-0"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(null)}
                        aria-label="Cancelar edición"
                        className="h-9 w-9 shrink-0 px-0"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORY_CHART_PALETTE[
                                resolvedIndex % CATEGORY_CHART_PALETTE.length
                              ],
                          }}
                        />
                        <h3 className="truncate text-sm font-semibold text-foreground">
                          {activeGroup.name}
                        </h3>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {activeLabels.length === 1
                            ? "1 etiqueta"
                            : `${activeLabels.length} etiquetas`}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Renombrar grupo ${activeGroup.name}`}
                          onClick={() =>
                            setEditing({
                              kind: "group",
                              id: activeGroup.id,
                              value: activeGroup.name,
                            })
                          }
                          className="h-9 w-9 px-0 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <InlineConfirmButton
                          ariaLabel={`Eliminar grupo ${activeGroup.name}`}
                          announce={`Confirma para eliminar el grupo ${activeGroup.name}`}
                          confirmLabel="¿Eliminar?"
                          onConfirm={() => {
                            void run(
                              () => deleteGroup.mutateAsync(activeGroup.id),
                              "Grupo eliminado",
                            );
                            setMobilePane("groups");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </InlineConfirmButton>
                      </div>
                    </>
                  )}
                </div>

                {/* Single new label form */}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateLabel(activeGroup.id);
                  }}
                  className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label="Nueva etiqueta"
                      placeholder="Nombre de la etiqueta…"
                      value={newLabelName}
                      onChange={(event) => setNewLabelName(event.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    loading={createLabel.isPending}
                    disabled={!newLabelName.trim()}
                    className="shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Agregar
                  </Button>
                </form>

                {/* Labels list */}
                <div className="scrollbar-app max-h-[300px] min-h-0 flex-1 overflow-y-auto md:max-h-none">
                  {activeLabels.length === 0 ? (
                    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                      <Tag
                        className="mb-1.5 h-5 w-5 text-muted-foreground/40"
                        aria-hidden="true"
                      />
                      <p className="text-[13px] font-medium text-muted-foreground">
                        Sin etiquetas en este grupo
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground/80">
                        Agrega una arriba para clasificar este grupo.
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {activeLabels.map((label) => (
                        <li
                          key={label.id}
                          className="group flex items-center justify-between gap-2 px-4 py-2 transition-colors duration-150 hover:bg-muted/25"
                        >
                          {editing?.kind === "label" && editing.id === label.id ? (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                handleSaveLabelEdit(activeGroup.id, label.id);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <Input
                                  aria-label={`Renombrar ${label.name}`}
                                  autoFocus
                                  value={editing.value}
                                  onChange={(event) =>
                                    setEditing({ ...editing, value: event.target.value })
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setEditing(null);
                                    }
                                  }}
                                />
                              </div>
                              <Button
                                type="submit"
                                size="sm"
                                loading={updateLabel.isPending}
                                disabled={!editing.value.trim()}
                                aria-label="Guardar nombre de la etiqueta"
                                className="h-9 w-9 shrink-0 px-0"
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => setEditing(null)}
                                aria-label="Cancelar edición"
                                className="h-9 w-9 shrink-0 px-0"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </form>
                          ) : (
                            <>
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <Tag
                                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span className="truncate text-sm text-foreground">
                                  {label.name}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-1 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Renombrar etiqueta ${label.name}`}
                                  onClick={() =>
                                    setEditing({
                                      kind: "label",
                                      id: label.id,
                                      groupId: activeGroup.id,
                                      value: label.name,
                                    })
                                  }
                                  className="h-9 w-9 px-0 text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                                <InlineConfirmButton
                                  ariaLabel={`Eliminar etiqueta ${label.name}`}
                                  announce={`Confirma para eliminar la etiqueta ${label.name}`}
                                  confirmLabel="¿Eliminar?"
                                  onConfirm={() =>
                                    void run(
                                      () =>
                                        deleteLabel.mutateAsync({
                                          groupId: activeGroup.id,
                                          id: label.id,
                                        }),
                                      "Etiqueta eliminada",
                                    )
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </InlineConfirmButton>
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
