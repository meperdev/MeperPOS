"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select, type SelectOption } from "@/components/ui/Select";
import { SITE_TYPE_LABEL } from "@/components/locations/SiteCard";
import { useToast } from "@/contexts/ToastContext";
import { useCreateLocation, useUpdateLocation } from "@/hooks/useLocations";
import { getApiErrorMessage } from "@/lib/api";
import type { LocationSite, LocationType } from "@/types";

const TYPE_OPTIONS: SelectOption[] = [
  { value: "STORE", label: SITE_TYPE_LABEL.STORE },
  { value: "WAREHOUSE", label: SITE_TYPE_LABEL.WAREHOUSE },
];

type SiteForm = {
  name: string;
  type: LocationType;
  address: string;
  phone: string;
};

const EMPTY_FORM: SiteForm = {
  name: "",
  type: "STORE",
  address: "",
  phone: "",
};

function formFrom(site: LocationSite): SiteForm {
  return {
    name: site.name,
    type: site.type,
    address: site.address ?? "",
    phone: site.phone ?? "",
  };
}

/**
 * Create/edit dialog for one site. It owns its form, so the list does not
 * re-render on every keystroke, and the actions live in the dialog footer.
 *
 * Creating a site grants nobody access to it (that is the per-person
 * assignment in the team screen); the principal site keeps its type because it
 * is the one that operates the point of sale.
 */
export function SiteFormDialog({
  site,
  onClose,
}: {
  /** The site being edited, or null to create a new one. */
  site: LocationSite | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();

  const [form, setForm] = useState<SiteForm>(() =>
    site ? formFrom(site) : EMPTY_FORM,
  );

  const isPrincipal = site?.isDefault === true;
  const isSaving = createLocation.isPending || updateLocation.isPending;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    // The API trims and turns a blank value into null, which is how a cleared
    // address or phone stops printing on the receipt.
    const contact = { address: form.address.trim(), phone: form.phone.trim() };

    try {
      if (site) {
        // The principal site keeps its type: the server refuses the change and
        // the form never offers it.
        await updateLocation.mutateAsync({
          id: site.id,
          data: isPrincipal
            ? { name, ...contact }
            : { name, type: form.type, ...contact },
        });
        toast.success("Sede actualizada", { description: name });
      } else {
        await createLocation.mutateAsync({ name, type: form.type, ...contact });
        toast.success("Sede creada", {
          description: "Asigna el acceso a cada persona desde Usuarios.",
        });
      }
      onClose();
    } catch (error) {
      toast.error("No se pudo guardar la sede", {
        description: getApiErrorMessage(
          error,
          "Revisa el nombre y el tipo de sede.",
        ),
      });
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={site ? "Editar sede" : "Nueva sede"}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="site-form" loading={isSaving}>
            {site ? "Guardar" : "Crear sede"}
          </Button>
        </div>
      }
    >
      <form id="site-form" onSubmit={handleSubmit} className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Datos de la sede
          </h3>
          <Input
            label="Nombre"
            placeholder="Ej: Sede centro"
            value={form.name}
            maxLength={80}
            required
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
          />
          <div>
            <Select
              label="Tipo"
              options={TYPE_OPTIONS}
              value={form.type}
              disabled={isPrincipal}
              onChange={(value) =>
                setForm({ ...form, type: value as LocationType })
              }
            />
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {isPrincipal
                ? "La sede principal opera el punto de venta, así que se mantiene como sucursal."
                : "Las sucursales operan el punto de venta; las bodegas solo guardan inventario."}
            </p>
          </div>
        </section>

        <section className="space-y-3 border-t border-border/60 pt-4">
          <h3 className="text-sm font-semibold text-foreground">Contacto</h3>
          <Input
            label="Dirección"
            placeholder="Ej: Calle 10 # 5-20"
            value={form.address}
            maxLength={200}
            onChange={(event) =>
              setForm({ ...form, address: event.target.value })
            }
          />
          <Input
            label="Teléfono"
            placeholder="Ej: 604 444 5566"
            value={form.phone}
            maxLength={40}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <p className="text-[13px] text-muted-foreground">
            La dirección y el teléfono se imprimen en el comprobante de venta,
            debajo del nombre del negocio.
          </p>
        </section>
      </form>
    </Modal>
  );
}
