"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import {
  useCreateEmployee,
  useUpdateEmployee,
  type Employee,
  type EmployeeModality,
  type EmployeePayload,
} from "@/hooks/useEmployees";

type Form = {
  name: string;
  identification: string;
  phone: string;
  email: string;
  address: string;
  jobTitle: string;
  startDate: string;
  remunerationModality: "" | EmployeeModality;
  referenceAmount: string;
};

const EMPTY_FORM: Form = {
  name: "",
  identification: "",
  phone: "",
  email: "",
  address: "",
  jobTitle: "",
  startDate: "",
  remunerationModality: "",
  referenceAmount: "",
};

const MODALITY_OPTIONS = [
  { value: "", label: "Sin especificar" },
  { value: "FIXED", label: "Salario fijo" },
  { value: "BY_DAY", label: "Por día" },
  { value: "OTHER", label: "Otro acuerdo" },
];

function formFrom(employee: Employee): Form {
  return {
    name: employee.name,
    identification: employee.identification ?? "",
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    address: employee.address ?? "",
    jobTitle: employee.jobTitle ?? "",
    startDate: employee.startDate?.slice(0, 10) ?? "",
    remunerationModality: employee.remunerationModality ?? "",
    referenceAmount: employee.referenceAmount ?? "",
  };
}

/**
 * Create/edit sheet for an employee. It owns its form, so the list does not
 * re-render on every keystroke, and the actions live in the dialog footer.
 */
export function EmployeeFormDialog({
  employee,
  onClose,
}: {
  employee: Employee | null;
  onClose: () => void;
}) {
  const editing = employee !== null;
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const toast = useToast();

  const [form, setForm] = useState<Form>(() =>
    employee ? formFrom(employee) : EMPTY_FORM,
  );
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Form, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);

    const nullable = (value: string) => value.trim() || null;
    const data: EmployeePayload = {
      name: form.name.trim(),
      identification: nullable(form.identification),
      phone: nullable(form.phone),
      email: nullable(form.email),
      address: nullable(form.address),
      jobTitle: nullable(form.jobTitle),
      startDate: form.startDate || null,
      remunerationModality: form.remunerationModality || null,
      referenceAmount:
        form.referenceAmount === "" ? null : Number(form.referenceAmount),
    };

    setSaving(true);
    try {
      if (editing && employee) {
        await update.mutateAsync({ id: employee.id, data });
      } else {
        await create.mutateAsync(data);
      }
      toast.success(editing ? "Empleado actualizado" : "Empleado creado");
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo guardar el empleado"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => {
        if (!saving) onClose();
      }}
      title={editing ? "Editar empleado" : "Nuevo empleado"}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button type="submit" form="employee-form" loading={saving}>
            Guardar
          </Button>
        </div>
      }
    >
      <form id="employee-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            label="Nombre"
            required
            maxLength={200}
            value={form.name}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? "employee-name-error" : undefined}
            onChange={(event) => {
              set("name", event.target.value);
              if (event.target.value.trim()) setNameError(false);
            }}
          />
          {nameError && (
            <p id="employee-name-error" role="alert" className="mt-1.5 text-xs text-danger">
              Ingresa un nombre válido
            </p>
          )}
        </div>

        <Input
          label="Identificación"
          maxLength={200}
          value={form.identification}
          onChange={(event) => set("identification", event.target.value)}
        />
        <Input
          label="Cargo"
          maxLength={200}
          value={form.jobTitle}
          onChange={(event) => set("jobTitle", event.target.value)}
        />
        <Input
          label="Teléfono"
          maxLength={200}
          value={form.phone}
          onChange={(event) => set("phone", event.target.value)}
        />
        <Input
          label="Correo electrónico"
          type="email"
          maxLength={200}
          value={form.email}
          onChange={(event) => set("email", event.target.value)}
        />
        <div className="sm:col-span-2">
          <Input
            label="Dirección"
            maxLength={500}
            value={form.address}
            onChange={(event) => set("address", event.target.value)}
          />
        </div>

        <Input
          label="Fecha de ingreso"
          type="date"
          value={form.startDate}
          onChange={(event) => set("startDate", event.target.value)}
        />
        <Select
          label="Modalidad de remuneración"
          options={MODALITY_OPTIONS}
          value={form.remunerationModality}
          onChange={(event) =>
            set("remunerationModality", event.target.value)
          }
        />

        <div className="sm:col-span-2">
          <Input
            label="Valor de referencia"
            type="number"
            inputMode="decimal"
            min="0"
            max="9999999999.99"
            step="0.01"
            value={form.referenceAmount}
            onChange={(event) => set("referenceAmount", event.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Es la base que se propone al crear un pago de nómina; el servidor lo
            guarda tal cual y nunca lo usa para calcular un pago por sí solo.
          </p>
        </div>
      </form>
    </Modal>
  );
}
