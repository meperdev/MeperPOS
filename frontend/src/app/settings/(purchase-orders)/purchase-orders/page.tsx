"use client";

import { useState } from "react";
import Image from "next/image";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/LoadingState";
import { SettingsCard } from "../../_components/SettingsCard";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ClipboardList, Store } from "lucide-react";
import type { PurchaseOrderTemplate, Settings } from "@/types";

/** The limits the backend enforces (`PurchaseOrderTemplateDto`). */
const MAX_LENGTH = {
  deliveryAddress: 300,
  paymentTerms: 200,
  terms: 2000,
  footer: 500,
} as const;

const sampleItems = [
  { name: "Café de origen 500 g", sku: "CAF-500", quantity: 12, cost: 21000 },
  { name: "Azúcar morena 1 kg", sku: "AZU-1000", quantity: 20, cost: 4800 },
];

const EMPTY_TEMPLATE: PurchaseOrderTemplate = {
  deliveryAddress: "",
  paymentTerms: "",
  terms: "",
  footer: "",
};

function PurchaseOrderPreview({
  organization,
  template,
}: {
  organization: Settings["organization"];
  template: PurchaseOrderTemplate;
}) {
  const subtotal = sampleItems.reduce(
    (total, item) => total + item.quantity * item.cost,
    0,
  );
  const tax = subtotal * 0.19;
  const deliveryAddress =
    template.deliveryAddress.trim() || organization.address?.trim() || "";

  return (
    <Card className="overflow-hidden border-border/70 bg-card shadow-2xs">
      <div className="border-b border-border/60 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="mt-0.5 text-xs sm:text-sm font-semibold tracking-tight text-foreground">
            Orden de compra de muestra
          </h2>
          <ClipboardList
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Se actualiza en vivo. El PDF que recibe el proveedor sale en tamaño
          carta con este contenido.
        </p>
      </div>

      <div className="bg-muted/20 p-4 sm:p-5">
        <article
          className="mx-auto w-full max-w-md overflow-hidden rounded-xl border border-border/70 bg-card px-5 py-5 text-xs shadow-2xs"
          aria-label="Vista previa de la orden de compra"
        >
          <header className="flex items-start justify-between gap-4 border-b border-border/70 pb-3.5">
            <div className="flex min-w-0 items-start gap-3">
              {organization.logoUrl ? (
                <Image
                  src={organization.logoUrl}
                  alt={`Logo de ${organization.name || "la organización"}`}
                  width={96}
                  height={40}
                  unoptimized
                  className="h-auto max-h-10 w-auto max-w-24 object-contain"
                />
              ) : (
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/30 text-muted-foreground"
                  aria-label="Sin logo configurado"
                >
                  <Store className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 space-y-0.5">
                <h3 className="break-words text-sm font-semibold tracking-tight text-foreground">
                  {organization.name || "Nombre de la organización"}
                </h3>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  {organization.taxId ? <p>NIT {organization.taxId}</p> : null}
                  {organization.phone ? <p>Tel. {organization.phone}</p> : null}
                  {organization.address ? <p>{organization.address}</p> : null}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-foreground">
                Orden de compra
              </p>
              <p className="font-mono text-[11px] font-semibold tabular-nums text-foreground">
                OC-184
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDate(new Date())}
              </p>
            </div>
          </header>

          <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
            <section className="rounded-lg border border-border/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Proveedor
              </p>
              <p className="mt-1 font-semibold text-foreground">
                Distribuidora de muestra
              </p>
              <p className="text-[11px] text-muted-foreground">NIT 900111222-3</p>
            </section>
            <section className="space-y-1.5 rounded-lg border border-border/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Entrega y pago
              </p>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground">
                  Entregar en
                </p>
                <p
                  aria-label="Entregar en"
                  className="break-words text-foreground"
                >
                  {deliveryAddress}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground">
                  Condiciones de pago
                </p>
                {template.paymentTerms.trim() ? (
                  <p className="whitespace-pre-line break-words text-foreground">
                    {template.paymentTerms}
                  </p>
                ) : (
                  <p className="text-muted-foreground/60">Sin especificar</p>
                )}
              </div>
            </section>
          </div>

          <section aria-label="Productos de muestra" className="mt-3.5 space-y-2">
            {sampleItems.map((item) => (
              <div
                key={item.sku}
                className="flex items-start justify-between gap-3 border-b border-border/50 pb-2"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">
                    {item.name}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {item.quantity} × {formatCurrency(item.cost)} · SKU {item.sku}
                  </p>
                </div>
                <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">
                  {formatCurrency(item.quantity * item.cost)}
                </span>
              </div>
            ))}
          </section>

          <section
            aria-label="Totales de muestra"
            className="ml-auto mt-3 w-48 space-y-1"
          >
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>IVA</span>
              <span className="font-mono tabular-nums">{formatCurrency(tax)}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-border/70 pt-1.5 text-sm font-semibold text-foreground">
              <span>Total</span>
              <span className="font-mono tabular-nums">
                {formatCurrency(subtotal + tax)}
              </span>
            </div>
          </section>

          {template.terms.trim() ? (
            <section className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Términos y condiciones
              </p>
              <p className="mt-1 whitespace-pre-line break-words leading-relaxed text-foreground">
                {template.terms}
              </p>
            </section>
          ) : null}

          <footer className="mt-4 border-t border-border/70 pt-3 text-center">
            {template.footer.trim() ? (
              <p className="whitespace-pre-line break-words text-[11px] text-muted-foreground">
                {template.footer}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground/60">
                Pie de página
              </p>
            )}
          </footer>
        </article>
      </div>
    </Card>
  );
}

export default function PurchaseOrderSettingsPage() {
  const toast = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const [template, setTemplate] = useState<PurchaseOrderTemplate>(EMPTY_TEMPLATE);
  const [syncedSettings, setSyncedSettings] = useState<typeof settings | null>(
    null,
  );

  // Render-phase sync: seed the fields from the server snapshot and re-seed
  // only when a new snapshot arrives, as the invoicing section does.
  if (settings && settings !== syncedSettings) {
    setSyncedSettings(settings);
    setTemplate({ ...EMPTY_TEMPLATE, ...settings.purchaseOrder });
  }

  if (isLoading || !settings) {
    return (
      <LoadingState
        icon={<ClipboardList className="w-4 h-4 text-muted-foreground" />}
        message="Cargando configuración…"
      />
    );
  }

  const setField =
    (field: keyof PurchaseOrderTemplate) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setTemplate((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await updateSettings.mutateAsync({ purchaseOrderTemplate: template });
      toast.success("Plantilla guardada");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo guardar la plantilla"));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          Órdenes de compra
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Lo que aparece en cada orden que le envías a un proveedor
        </p>
      </div>

      <div className="@container">
        <div className="grid items-start gap-4 @4xl:gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
          <SettingsCard
            title="Plantilla del documento"
            description="El nombre, el NIT, el teléfono y el logo salen de la sección General"
            icon={<ClipboardList className="w-4 h-4" />}
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Dirección de entrega"
                value={template.deliveryAddress}
                onChange={setField("deliveryAddress")}
                maxLength={MAX_LENGTH.deliveryAddress}
                placeholder={
                  settings.organization.address
                    ? `Si queda vacío: ${settings.organization.address}`
                    : "Ej. Bodega 4, Zona Franca"
                }
              />
              <Input
                label="Condiciones de pago"
                value={template.paymentTerms}
                onChange={setField("paymentTerms")}
                maxLength={MAX_LENGTH.paymentTerms}
                placeholder="Ej. Crédito a 30 días"
              />
              <Input
                label="Términos y condiciones"
                textarea
                rows={4}
                value={template.terms}
                onChange={setField("terms")}
                maxLength={MAX_LENGTH.terms}
                placeholder="Ej. Se recibe solo mercancía con factura"
              />
              <Input
                label="Pie de página"
                value={template.footer}
                onChange={setField("footer")}
                maxLength={MAX_LENGTH.footer}
                placeholder="Texto al pie de cada página"
              />

              <div className="flex justify-end pt-2">
                <Button type="submit" loading={updateSettings.isPending}>
                  Guardar plantilla
                </Button>
              </div>
            </form>
          </SettingsCard>

          <div className="@4xl:sticky @4xl:top-5">
            <PurchaseOrderPreview
              organization={settings.organization}
              template={template}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
