"use client";

import { useState } from "react";
import Image from "next/image";
import {
  useSettings,
  useUpdateSettings,
  useUpdateReceiptPrefix,
} from "@/hooks/useSettings";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/LoadingState";
import { SettingsCard } from "../../_components/SettingsCard";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { Hash, Receipt, Store } from "lucide-react";

const sampleItems = [
  { name: "Café especial", quantity: 2, price: 18000 },
  { name: "Pan artesanal", quantity: 1, price: 12000 },
];

function ReceiptPreview({
  organizationName,
  logoUrl,
  printHeader,
  printFooter,
  prefix,
}: {
  organizationName: string;
  logoUrl: string | null;
  printHeader: string;
  printFooter: string;
  prefix: string;
}) {
  const subtotal = sampleItems.reduce(
    (total, item) => total + item.quantity * item.price,
    0,
  );
  const discount = 5000;
  const taxableSubtotal = subtotal - discount;
  const tax = taxableSubtotal * 0.19;
  const total = taxableSubtotal + tax;
  const sampleNumber = `${prefix || "REC-"}000184`;

  return (
    <Card className="overflow-hidden border-border/70 bg-card shadow-2xs">
      <div className="border-b border-border/60 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">
              Vista previa
            </p>
            <h2 className="mt-0.5 text-xs sm:text-sm font-semibold tracking-tight text-foreground">
              Comprobante / recibo de muestra
            </h2>
          </div>
          <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Se actualiza en vivo. Es una muestra ilustrativa y no un documento electrónico válido.
        </p>
      </div>

      <div className="bg-muted/20 p-4 sm:p-5">
        <article
          className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border/70 bg-card px-5 py-5 shadow-2xs"
          aria-label="Vista previa del comprobante"
        >
          <header className="text-center">
            <div className="mb-3 flex min-h-12 items-center justify-center">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={`Logo de ${organizationName || "la organización"}`}
                  width={144}
                  height={48}
                  unoptimized
                  className="h-auto max-h-12 w-auto max-w-36 object-contain"
                />
              ) : (
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/30 text-muted-foreground"
                  aria-label="Sin logo configurado"
                >
                  <Store className="h-5 w-5" aria-hidden="true" />
                </div>
              )}
            </div>
            <h3 className="break-words text-base font-semibold tracking-tight text-foreground">
              {organizationName || "Nombre de la organización"}
            </h3>
            {printHeader ? (
              <p className="mt-1.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
                {printHeader}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground/60">
                Encabezado de impresión
              </p>
            )}
            <div className="mt-3.5 space-y-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              <p className="font-semibold text-foreground">Comprobante #{sampleNumber}</p>
              <p>{formatDateTime(new Date())}</p>
            </div>
          </header>

          <div className="my-4 border-t border-dashed border-border/70" />

          <section aria-label="Productos de muestra" className="space-y-2.5">
            {sampleItems.map((item) => (
              <div key={item.name} className="text-xs">
                <div className="flex items-start justify-between gap-3 font-medium text-foreground">
                  <span className="min-w-0 break-words">{item.name}</span>
                  <span className="shrink-0 font-mono font-semibold tabular-nums">
                    {formatCurrency(item.quantity * item.price)}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {item.quantity} × {formatCurrency(item.price)}
                </p>
              </div>
            ))}
          </section>

          <div className="my-4 border-t border-dashed border-border/70" />

          <section aria-label="Totales de muestra" className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>Descuento</span>
              <span className="font-mono tabular-nums">-{formatCurrency(discount)}</span>
            </div>
            <div className="flex justify-between gap-3 text-muted-foreground">
              <span>Impuestos (19%)</span>
              <span className="font-mono tabular-nums">{formatCurrency(tax)}</span>
            </div>
            <div className="mt-2.5 flex justify-between gap-3 border-t border-border/70 pt-2.5 text-sm font-semibold text-foreground">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatCurrency(total)}</span>
            </div>
          </section>

          <footer className="mt-5 border-t border-border/70 pt-3.5 text-center">
            {printFooter ? (
              <p className="whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
                {printFooter}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60">
                Pie de página de impresión
              </p>
            )}
          </footer>
        </article>
      </div>
    </Card>
  );
}

export default function InvoicingSettingsPage() {
  const toast = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const updateReceiptPrefix = useUpdateReceiptPrefix();

  const [printHeader, setPrintHeader] = useState("");
  const [printFooter, setPrintFooter] = useState("");
  const [prefix, setPrefix] = useState("");
  const [syncedSettings, setSyncedSettings] = useState<typeof settings | null>(null);

  // Render-phase sync: seed the editable fields from the server snapshot and
  // re-seed only when a new snapshot arrives, avoiding an effect cascade.
  if (settings && settings !== syncedSettings) {
    setSyncedSettings(settings);
    setPrintHeader(settings.invoicing.printHeader ?? "");
    setPrintFooter(settings.invoicing.printFooter ?? "");
    setPrefix(settings.receipt.prefix ?? "");
  }

  if (isLoading || !settings) {
    return (
      <LoadingState
        icon={<Receipt className="w-4 h-4 text-muted-foreground" />}
        message="Cargando configuración..."
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({ printHeader, printFooter });
      toast.success("Configuración guardada correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al guardar la configuración"));
    }
  };

  const handlePrefixSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateReceiptPrefix.mutateAsync(prefix);
      toast.success("Prefijo guardado correctamente");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Error al guardar el prefijo"));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
          Facturación y recibos
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Personaliza los textos e identificadores de tus comprobantes
        </p>
      </div>

      <div className="grid items-start gap-4 lg:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <div className="space-y-4">
          <SettingsCard
            title="Impresión de comprobantes"
            description="Encabezado y pie que aparecen en los recibos"
            icon={<Receipt className="w-4 h-4" />}
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Encabezado de impresión"
                textarea
                rows={3}
                value={printHeader}
                onChange={(e) => setPrintHeader(e.target.value)}
                placeholder="Información que aparecerá en el encabezado de los recibos"
              />
              <Input
                label="Pie de página de impresión"
                value={printFooter}
                onChange={(e) => setPrintFooter(e.target.value)}
                placeholder="Información que aparecerá al pie de los recibos"
              />

              <div className="flex justify-end pt-2">
                <Button type="submit" loading={updateSettings.isPending}>
                  Guardar
                </Button>
              </div>
            </form>
          </SettingsCard>

          <SettingsCard
            title="Prefijo de comprobante"
            description="Prefijo que antecede al número de cada recibo"
            icon={<Hash className="w-4 h-4" />}
          >
            <form onSubmit={handlePrefixSubmit} className="space-y-4">
              <Input
                label="Prefijo de comprobante"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="Ej. REC-"
              />

              <div className="flex justify-end pt-2">
                <Button type="submit" loading={updateReceiptPrefix.isPending}>
                  Guardar prefijo
                </Button>
              </div>
            </form>
          </SettingsCard>
        </div>

        <div className={cn("lg:sticky lg:top-5")}>
          <ReceiptPreview
            organizationName={settings.organization.name}
            logoUrl={settings.organization.logoUrl}
            printHeader={printHeader}
            printFooter={printFooter}
            prefix={prefix}
          />
        </div>
      </div>
    </div>
  );
}
