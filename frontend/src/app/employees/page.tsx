"use client";

import { useId, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmployeeDialog } from "./EmployeeDialog";
import { ShiftDialog } from "./ShiftDialog";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useEmployees, useCreateEmployee, useUpdateEmployee, useSetEmployeeActive, type Employee, type EmployeeModality, type EmployeePayload } from "@/hooks/useEmployees";

type Form = { name: string; identification: string; phone: string; email: string; address: string; jobTitle: string; startDate: string; remunerationModality: "" | EmployeeModality; referenceAmount: string };
const emptyForm: Form = { name: "", identification: "", phone: "", email: "", address: "", jobTitle: "", startDate: "", remunerationModality: "", referenceAmount: "" };
const modalities: Record<EmployeeModality, string> = { FIXED: "Salario fijo", BY_DAY: "Por día", OTHER: "Otro acuerdo" };

export default function EmployeesPage() {
  const { user } = useAuth();
  const allowed = user?.role === "OWNER" || user?.role === "ADMIN";
  const employees = useEmployees(allowed);
  const create = useCreateEmployee(); const update = useUpdateEmployee(); const setActive = useSetEmployeeActive();
  const toast = useToast();
  const [form, setForm] = useState<Form>(emptyForm);
  const [nameError, setNameError] = useState(false);
  const nameErrorId = useId();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [shiftEmployeeId, setShiftEmployeeId] = useState<string | null>(null);
  const shiftEmployee = employees.data?.find((employee) => employee.id === shiftEmployeeId);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  function edit(employee: Employee) {
    setEditing(employee);
    setNameError(false);
    setForm({ name: employee.name, identification: employee.identification ?? "", phone: employee.phone ?? "", email: employee.email ?? "", address: employee.address ?? "", jobTitle: employee.jobTitle ?? "", startDate: employee.startDate?.slice(0, 10) ?? "", remunerationModality: employee.remunerationModality ?? "", referenceAmount: employee.referenceAmount ?? "" });
    setOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!allowed || saving) return;
    if (!form.name.trim()) { setNameError(true); return; }
    setNameError(false);
    const nullable = (value: string) => value.trim() || null;
    const data: EmployeePayload = { name: form.name.trim(), identification: nullable(form.identification), phone: nullable(form.phone), email: nullable(form.email), address: nullable(form.address), jobTitle: nullable(form.jobTitle), startDate: form.startDate || null, remunerationModality: form.remunerationModality || null, referenceAmount: form.referenceAmount === "" ? null : Number(form.referenceAmount) };
    setSaving(true);
    try {
      if (editing) await update.mutateAsync({ id: editing.id, data }); else await create.mutateAsync(data);
      toast.success(editing ? "Empleado actualizado" : "Empleado creado"); setOpen(false);
    } catch (error) { toast.error(getApiErrorMessage(error, "No se pudo guardar el empleado")); }
    finally { setSaving(false); }
  }
  async function toggle(employee: Employee) {
    if (!allowed || changingId) return;
    setChangingId(employee.id);
    try { await setActive.mutateAsync({ id: employee.id, active: !employee.active }); toast.success("Estado actualizado"); }
    catch (error) { toast.error(getApiErrorMessage(error, "No se pudo cambiar el estado")); }
    finally { setChangingId(null); }
  }
  return <DashboardLayout>{allowed && <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Empleados</h1><p className="text-sm text-muted-foreground">Gestiona los datos de tus empleados</p></div><Button onClick={() => { setEditing(null); setNameError(false); setForm(emptyForm); setOpen(true); }}>Nuevo empleado</Button></div>
    {employees.isLoading ? <LoadingState icon={<span>…</span>} message="Cargando empleados..." /> : employees.isError ? <ErrorState message="No se pudieron cargar los empleados" retryLabel="Reintentar" onRetry={() => void employees.refetch()} /> : !employees.data?.length ? <EmptyState icon={<span>•</span>} title="No hay empleados" subtitle="Agrega tu primer empleado" /> : <div className="grid gap-4 md:grid-cols-2">{employees.data.map((employee) => <article key={employee.id} className="rounded-xl border border-border bg-card p-4 space-y-2"><h2 className="font-semibold">{employee.name}</h2><p className="text-sm">{employee.active ? "Activo" : "Inactivo"}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</p><p className="text-sm text-muted-foreground">{employee.identification || "Sin identificación"}{employee.phone ? ` · ${employee.phone}` : ""}{employee.email ? ` · ${employee.email}` : ""}</p><p className="text-sm text-muted-foreground">{employee.remunerationModality ? modalities[employee.remunerationModality] : "Sin modalidad"}{employee.referenceAmount !== null ? ` · ${formatCurrency(Number(employee.referenceAmount))}` : ""}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShiftEmployeeId(employee.id)} aria-label={`Jornadas ${employee.name}`}>Jornadas</Button><Button variant="outline" onClick={() => edit(employee)} aria-label={`Editar ${employee.name}`}>Editar</Button><Button variant="outline" disabled={changingId !== null} onClick={() => void toggle(employee)} aria-label={`${employee.active ? "Desactivar" : "Activar"} ${employee.name}`}>{employee.active ? "Desactivar" : "Activar"}</Button></div></article>)}</div>}
    {shiftEmployee && <ShiftDialog employee={shiftEmployee} onClose={() => setShiftEmployeeId(null)} />}
    {open && <EmployeeDialog onClose={() => { if (!saving) setOpen(false); }} title={editing ? "Editar empleado" : "Nuevo empleado"}><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div><Input label="Nombre" required maxLength={200} value={form.name} aria-invalid={nameError || undefined} aria-describedby={nameError ? nameErrorId : undefined} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (e.target.value.trim()) setNameError(false); }} />{nameError && <p id={nameErrorId} role="alert" className="mt-1.5 text-xs text-danger">Ingresa un nombre válido</p>}</div>
      <Input label="Identificación" maxLength={200} value={form.identification} onChange={(e) => setForm({ ...form, identification: e.target.value })} />
      <Input label="Teléfono" maxLength={200} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <Input label="Correo electrónico" type="email" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <Input label="Dirección" maxLength={500} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <Input label="Cargo" maxLength={200} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
      <Input label="Fecha de ingreso" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
      <label className="text-xs font-semibold uppercase text-muted-foreground">Modalidad de remuneración<select className="mt-1.5 w-full rounded-xl border border-border bg-card p-3 text-foreground" value={form.remunerationModality} onChange={(e) => setForm({ ...form, remunerationModality: e.target.value as Form["remunerationModality"] })}><option value="">Sin especificar</option>{Object.entries(modalities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Input label="Valor de referencia" type="number" min="0" max="9999999999.99" step="0.01" value={form.referenceAmount} onChange={(e) => setForm({ ...form, referenceAmount: e.target.value })} />
      <div className="sm:col-span-2"><Button type="submit" disabled={saving}>Guardar</Button></div>
    </form></EmployeeDialog>}
  </div>}</DashboardLayout>;
}
