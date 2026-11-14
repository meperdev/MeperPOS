"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
import { Pencil, Plus, Trash2, Tag, Folder } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ExpenseTaxonomyModal({ isOpen, onClose }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: groups = [], isLoading, isError } = useExpenseGroups();
  const createGroup = useCreateExpenseGroup();
  const updateGroup = useUpdateExpenseGroup();
  const deleteGroup = useDeleteExpenseGroup();
  const createLabel = useCreateExpenseLabel();
  const updateLabel = useUpdateExpenseLabel();
  const deleteLabel = useDeleteExpenseLabel();
  const [groupName, setGroupName] = useState("");
  const [newLabel, setNewLabel] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; groupId?: string; value: string } | null>(null);

  if (!hasAnyRole(user?.role, ["ADMIN"])) return null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo actualizar la taxonomía"));
    }
  };

  const handleCreateGroup = () => {
    if (!groupName.trim() || createGroup.isPending) return;
    void run(async () => {
      await createGroup.mutateAsync({ name: groupName.trim() });
      setGroupName("");
    }, "Grupo creado");
  };

  const handleCreateLabel = (groupId: string) => {
    const name = newLabel[groupId]?.trim();
    if (!name || createLabel.isPending) return;
    void run(async () => {
      await createLabel.mutateAsync({
        groupId,
        data: { name },
      });
      setNewLabel({ ...newLabel, [groupId]: "" });
    }, "Etiqueta creada");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gestionar categorías"
      size="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <p className="text-xs text-muted-foreground font-mono tabular-nums">
            {groups.length} {groups.length === 1 ? "grupo activo" : "grupos activos"}
          </p>
          <Button type="button" variant="secondary" onClick={onClose}>
            Listo
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Top Section: Create New Group */}
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4 shadow-2xs space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              Crear nuevo grupo de gasto
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Organiza tus salidas en grupos lógicos para clasificar compras, suministros, nómina y servicios.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Input
                label="Nuevo grupo"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateGroup();
                  }
                }}
                placeholder="Nombre del grupo (ej. Publicidad, Logística)"
              />
            </div>
            <Button
              type="button"
              className="w-full shrink-0 sm:w-auto h-9"
              disabled={!groupName.trim() || createGroup.isPending}
              onClick={handleCreateGroup}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Nuevo grupo
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Cargando grupos...
          </div>
        )}
        {isError && (
          <p role="alert" className="py-4 text-sm text-danger text-center">
            No se pudieron cargar los grupos.
          </p>
        )}
        {!isLoading && groups.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No hay grupos configurados.
          </div>
        )}

        {/* Groups Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map((group) => {
            const activeLabels = (group.labels ?? []).filter((l) => l.active !== false);

            return (
              <div
                key={group.id}
                className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-2xs transition-colors hover:border-border flex flex-col max-h-[340px]"
              >
                {/* Group Header */}
                <div className="flex items-center gap-2 pb-3 border-b border-border/60 shrink-0">
                  <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    {editing?.id === group.id ? (
                      <Input
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editing.value.trim()) {
                            e.preventDefault();
                            void run(async () => {
                              await updateGroup.mutateAsync({
                                id: group.id,
                                data: { name: editing.value.trim() },
                              });
                              setEditing(null);
                            }, "Grupo actualizado");
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-2 truncate">
                        <h3 className="font-semibold text-sm text-foreground truncate">
                          {group.name}
                        </h3>
                        <span className="text-[11px] font-mono text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/60 tabular-nums shrink-0">
                          {activeLabels.length} {activeLabels.length === 1 ? "etiqueta" : "etiquetas"}
                        </span>
                      </div>
                    )}
                  </div>
                  {editing?.id === group.id ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        void run(async () => {
                          await updateGroup.mutateAsync({
                            id: group.id,
                            data: { name: editing.value.trim() },
                          });
                          setEditing(null);
                        }, "Grupo actualizado")
                      }
                    >
                      Guardar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Editar ${group.name}`}
                      onClick={() => setEditing({ id: group.id, value: group.name })}
                      className="p-1 h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Desactivar ${group.name}`}
                    onClick={() => void run(() => deleteGroup.mutateAsync(group.id), "Grupo desactivado")}
                    className="p-1 h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>

                {/* Labels List with smooth internal scroll */}
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-app py-2.5 pr-1 space-y-1.5">
                  {activeLabels.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-6 px-2">
                      <Tag className="w-5 h-5 text-muted-foreground/30 mb-1.5" />
                      <p className="text-xs text-muted-foreground/70">Sin etiquetas</p>
                      <p className="text-[11px] text-muted-foreground/40 mt-0.5">
                        Agrega una abajo para clasificar este grupo
                      </p>
                    </div>
                  ) : (
                    activeLabels.map((label) => (
                      <div
                        key={label.id}
                        className="flex items-center gap-2 text-xs py-1.5 px-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors border border-transparent hover:border-border/40"
                      >
                        <Tag className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                        {editing?.id === label.id ? (
                          <Input
                            value={editing.value}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editing.value.trim()) {
                                e.preventDefault();
                                void run(async () => {
                                  await updateLabel.mutateAsync({
                                    groupId: group.id,
                                    id: label.id,
                                    data: { name: editing.value.trim() },
                                  });
                                  setEditing(null);
                                }, "Etiqueta actualizada");
                              }
                            }}
                          />
                        ) : (
                          <span className="flex-1 text-foreground font-medium truncate">
                            {label.name}
                          </span>
                        )}
                        {editing?.id === label.id ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              void run(async () => {
                                await updateLabel.mutateAsync({
                                  groupId: group.id,
                                  id: label.id,
                                  data: { name: editing.value.trim() },
                                });
                                setEditing(null);
                              }, "Etiqueta actualizada")
                            }
                          >
                            Guardar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Editar ${label.name}`}
                            onClick={() =>
                              setEditing({ id: label.id, groupId: group.id, value: label.name })
                            }
                            className="p-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Desactivar ${label.name}`}
                          onClick={() =>
                            void run(
                              () => deleteLabel.mutateAsync({ groupId: group.id, id: label.id }),
                              "Etiqueta desactivada",
                            )
                          }
                          className="p-1 h-6 w-6 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add new label input */}
                <div className="flex items-end gap-2 pt-2.5 border-t border-border/40 shrink-0">
                  <div className="flex-1">
                    <Input
                      label="Nueva etiqueta"
                      value={newLabel[group.id] ?? ""}
                      onChange={(e) =>
                        setNewLabel({ ...newLabel, [group.id]: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateLabel(group.id);
                        }
                      }}
                      placeholder="Nombre de la etiqueta"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!newLabel[group.id]?.trim()}
                    onClick={() => handleCreateLabel(group.id)}
                    className="shrink-0 h-9"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Agregar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
