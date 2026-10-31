"use client";

import { useMemo, useState } from "react";
import { CalendarClock, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CardSkeleton } from "@/components/ui/CardSkeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  FilterBar,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { RowActions, type RowActionItem } from "@/components/ui/RowActions";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn, formatCurrency, formatDate, toFiniteNumber } from "@/lib/utils";
import {
  useEmployees,
  useSetEmployeeActive,
  type Employee,
  type EmployeeModality,
} from "@/hooks/useEmployees";
import { EmployeeFormDialog } from "./EmployeeFormDialog";
import { ShiftDialog } from "./ShiftDialog";

const MODALITY_LABELS: Record<EmployeeModality, string> = {
  FIXED: "Salario fijo",
  BY_DAY: "Por día",
  OTHER: "Otro acuerdo",
};

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const EMPTY_LABELS = new Set(["Sin registrar", "Sin definir"]);

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate text-xs",
          EMPTY_LABELS.has(value) ? "text-muted-foreground" : "text-foreground",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function cardActions(
  employee: Employee,
  pending: boolean,
  onEdit: () => void,
  onToggle: () => void,
): RowActionItem[] {
  return [
    { label: "Editar", onSelect: onEdit },
    {
      label: employee.active ? "Desactivar" : "Activar",
      icon: employee.active ? (
        <UserX className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
      ),
      onSelect: onToggle,
      disabled: pending,
    },
  ];
}

function EmployeeCard({
  employee,
  pending,
  onEdit,
  onShifts,
  onToggle,
}: {
  employee: Employee;
  pending: boolean;
  onEdit: () => void;
  onShifts: () => void;
  onToggle: () => void;
}) {
  const contact = [employee.phone, employee.email].filter(Boolean).join(" · ");

  return (
    <Card className="flex flex-col" onClick={onEdit}>
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 font-mono text-xs font-semibold text-primary-text">
          {initials(employee.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {employee.name}
            </h2>
            <Badge variant={employee.active ? "success" : "default"} dot>
              {employee.active ? "Activo" : "Inactivo"}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {employee.jobTitle ?? "Sin cargo asignado"}
          </p>
        </div>
      </div>

      <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2.5 px-4 pb-4">
        <Meta
          label="Identificación"
          value={employee.identification ?? "Sin registrar"}
          mono
        />
        <Meta label="Contacto" value={contact || "Sin registrar"} />
        <Meta
          label="Modalidad"
          value={
            employee.remunerationModality
              ? MODALITY_LABELS[employee.remunerationModality]
              : "Sin definir"
          }
        />
        <Meta
          label="Valor de referencia"
          value={
            employee.referenceAmount !== null
              ? formatCurrency(toFiniteNumber(employee.referenceAmount))
              : "Sin definir"
          }
          mono
        />
        <div className="col-span-2">
          <Meta
            label="Ingreso"
            value={employee.startDate ? formatDate(employee.startDate) : "Sin registrar"}
          />
        </div>
      </dl>

      <div
        className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2.5"
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Jornadas ${employee.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onShifts();
          }}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          Jornadas
        </Button>
        <RowActions
          label={`Acciones de ${employee.name}`}
          items={cardActions(employee, pending, onEdit, onToggle)}
        />
      </div>
    </Card>
  );
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const allowed = user?.role === "OWNER" || user?.role === "ADMIN";
  const employees = useEmployees(allowed);
  const setActive = useSetEmployeeActive();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; employee: Employee } | null
  >(null);
  const [shiftFor, setShiftFor] = useState<Employee | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Employee | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = usePersistedViewMode("employees");
  const [page, setPage] = useState(1);
  const pageSize = viewMode === "table" ? 10 : 9;

  const filtered = useMemo(() => {
    const list = employees.data ?? [];
    const needle = query.trim().toLowerCase();
    return list.filter((employee) => {
      const matchesStatus =
        status === "all" || (status === "active" ? employee.active : !employee.active);
      if (!matchesStatus) return false;
      if (!needle) return true;
      const haystack = [
        employee.name,
        employee.jobTitle,
        employee.identification,
        employee.email,
        employee.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [employees.data, query, status]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  async function setEmployeeActive(employee: Employee, active: boolean) {
    if (changingId) return;
    setChangingId(employee.id);
    try {
      await setActive.mutateAsync({ id: employee.id, active });
      toast.success(
        active ? `${employee.name} quedó activo` : `${employee.name} quedó inactivo`,
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo cambiar el estado"));
    } finally {
      setChangingId(null);
    }
  }

  function requestToggle(employee: Employee) {
    if (employee.active) {
      setDeactivateTarget(employee);
      return;
    }
    void setEmployeeActive(employee, true);
  }

  if (!allowed) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <EmptyState
            icon={<Users className="h-5 w-5 text-muted-foreground" />}
            title="Sección privada"
            subtitle="Solo el propietario o un administrador gestionan los empleados."
          />
        </div>
      </DashboardLayout>
    );
  }

  const total = employees.data?.length ?? 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:gap-5">
        <PageHeader
          title="Empleados"
          subtitle="Datos, jornadas y estado del equipo"
          count={employees.data ? `${total} ${total === 1 ? "empleado" : "empleados"}` : undefined}
          actions={
            <Button onClick={() => setDialog({ mode: "create" })}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Nuevo empleado
            </Button>
          }
        />

        <FilterBar
          searchValue={query}
          onSearchChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          searchPlaceholder="Buscar por nombre, cargo o documento..."
          filterControls={
            <>
              <FilterGroup label="Estado">
                {STATUS_FILTERS.map((option) => (
                  <FilterOptionButton
                    key={option.value}
                    active={status === option.value}
                    onClick={() => {
                      setStatus(option.value);
                      setPage(1);
                    }}
                  >
                    {option.label}
                  </FilterOptionButton>
                ))}
              </FilterGroup>
              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => {
                  setViewMode(mode);
                  setPage(1);
                }}
              />
            </>
          }
        />

        {employees.isLoading ? (
          <CardSkeleton count={6} label="Cargando empleados..." />
        ) : employees.isError ? (
          <ErrorState
            message="No se pudieron cargar los empleados"
            retryLabel="Reintentar"
            onRetry={() => void employees.refetch()}
          />
        ) : total === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5 text-muted-foreground" />}
            title="No hay empleados"
            subtitle="Agrega tu primer empleado para registrar jornadas y pagos"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5 text-muted-foreground" />}
            title="Sin coincidencias"
            subtitle="Ajusta la búsqueda o el filtro de estado"
          />
        ) : (
          <>
            {viewMode === "table" ? (
              <>
                <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card sm:block">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableCell as="th">Empleado</TableCell>
                          <TableCell as="th">Contacto</TableCell>
                          <TableCell as="th">Modalidad</TableCell>
                          <TableCell as="th" className="text-right">
                            Valor base
                          </TableCell>
                          <TableCell as="th">Estado</TableCell>
                          <TableCell as="th" className="text-right">
                            <span className="sr-only">Acciones</span>
                          </TableCell>
                        </TableRow>
                      </TableHeader>
                      <tbody>
                        {paged.map((employee) => (
                          <TableRow
                            key={employee.id}
                            className="cursor-pointer"
                            onClick={() => setDialog({ mode: "edit", employee })}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/10 font-mono text-[10px] font-semibold text-primary-text">
                                  {initials(employee.name)}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-foreground">
                                    {employee.name}
                                  </p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {employee.jobTitle ?? "Sin cargo"}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <p className="truncate text-xs text-muted-foreground">
                                {[employee.phone, employee.email].filter(Boolean).join(" · ") || "Sin registrar"}
                              </p>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">
                                {employee.remunerationModality
                                  ? MODALITY_LABELS[employee.remunerationModality]
                                  : "Sin definir"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums">
                              {employee.referenceAmount !== null
                                ? formatCurrency(toFiniteNumber(employee.referenceAmount))
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={employee.active ? "success" : "default"} dot>
                                {employee.active ? "Activo" : "Inactivo"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div
                                className="flex items-center justify-end gap-1"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Editar ${employee.name}`}
                                  onClick={() => setDialog({ mode: "edit", employee })}
                                >
                                  Editar
                                </Button>
                                <RowActions
                                  label={`Acciones de ${employee.name}`}
                                  items={cardActions(
                                    employee,
                                    changingId === employee.id,
                                    () => setDialog({ mode: "edit", employee }),
                                    () => requestToggle(employee),
                                  )}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </div>
                <div className="stagger-children grid grid-cols-1 gap-3.5 sm:hidden">
                  {paged.map((employee) => (
                    <EmployeeCard
                      key={employee.id}
                      employee={employee}
                      pending={changingId === employee.id}
                      onEdit={() => setDialog({ mode: "edit", employee })}
                      onShifts={() => setShiftFor(employee)}
                      onToggle={() => requestToggle(employee)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="stagger-children grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {paged.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    pending={changingId === employee.id}
                    onEdit={() => setDialog({ mode: "edit", employee })}
                    onShifts={() => setShiftFor(employee)}
                    onToggle={() => requestToggle(employee)}
                  />
                ))}
              </div>
            )}
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              totalItems={filtered.length}
              pageSize={pageSize}
              itemLabel="empleado"
            />
          </>
        )}
      </div>

      {dialog && (
        <EmployeeFormDialog
          key={dialog.mode === "edit" ? dialog.employee.id : "create"}
          employee={dialog.mode === "edit" ? dialog.employee : null}
          onClose={() => setDialog(null)}
        />
      )}

      {shiftFor && (
        <ShiftDialog employee={shiftFor} onClose={() => setShiftFor(null)} />
      )}

      <ConfirmDialog
        isOpen={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={async () => {
          if (deactivateTarget) {
            await setEmployeeActive(deactivateTarget, false);
            setDeactivateTarget(null);
          }
        }}
        title="Desactivar empleado"
        message={`${deactivateTarget?.name ?? "El empleado"} deja de aparecer al crear pagos nuevos. Su historial se conserva y puedes activarlo de nuevo cuando quieras.`}
        confirmText="Desactivar"
        cancelText="Cancelar"
      />
    </DashboardLayout>
  );
}
