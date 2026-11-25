"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Stepper } from "@/components/ui/Stepper";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import {
  useAdjustProductStock,
  type ProductSiteStock,
} from "@/hooks/useProductStock";
import { cn } from "@/lib/utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName?: string;
  /** The sites the caller may adjust, with their live balances. */
  sites: ProductSiteStock[];
}

const TYPE_LABEL = { STORE: "Sucursal", WAREHOUSE: "Bodega" } as const;

const MAX_REASON_LENGTH = 200;

/**
 * T22 — "Ajustar existencias": one signed move at one chosen site.
 *
 * This dialog replaces the absolute stock field for an organization with more
 * than one site: the units enter or leave a named site, and the motive is
 * required because it is what the movement history will say afterwards.
 *
 * The server owns the rules — a withdrawal may not leave the site below its
 * reservations — so the dialog also caps a withdrawal at what the site can
 * actually give, and says so when it can give nothing, instead of offering a
 * button whose only possible answer is a refusal.
 */
export function StockAdjustmentModal({
  isOpen,
  onClose,
  productId,
  productName,
  sites,
}: Props) {
  const toast = useToast();
  const adjust = useAdjustProductStock();
  const [locationId, setLocationId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");

  const siteOptions: SelectOption[] = useMemo(
    () =>
      sites.map((site) => ({
        value: site.locationId,
        label: site.name,
        badge: site.isDefault ? "Principal" : TYPE_LABEL[site.type],
      })),
    [sites],
  );

  // Opening the dialog starts at the principal site — the one an operator most
  // often corrects — and never carries a previous draft over. The reset runs on
  // the closed → open transition only: a refreshed site list (a new array on
  // every render) must not wipe what is being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setLocationId(
        sites.find((entry) => entry.isDefault)?.locationId ??
          sites[0]?.locationId ??
          "",
      );
      setDirection("in");
      setQuantity(1);
      setReason("");
    }
    wasOpen.current = isOpen;
  }, [isOpen, sites]);

  const site = sites.find((entry) => entry.locationId === locationId);
  const available = site?.availableStock ?? 0;
  const withdrawingNothing = direction === "out" && available <= 0;

  // A withdrawal can give at most what the site holds beyond its reservations.
  // The bound is derived, never written back into state: switching direction or
  // site re-clamps what is on screen without an effect that could loop.
  const maxQuantity = direction === "out" ? Math.max(1, available) : undefined;
  const effectiveQuantity =
    direction === "out" ? Math.min(quantity, Math.max(1, available)) : quantity;

  const trimmedReason = reason.trim();
  const canSubmit =
    Boolean(site) &&
    !withdrawingNothing &&
    Number.isInteger(effectiveQuantity) &&
    effectiveQuantity >= 1 &&
    trimmedReason.length > 0 &&
    trimmedReason.length <= MAX_REASON_LENGTH &&
    !adjust.isPending;

  const close = () => {
    if (adjust.isPending) return;
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !site) return;

    const signedQuantity = direction === "in" ? quantity : -effectiveQuantity;
    try {
      await adjust.mutateAsync({
        productId,
        locationId: site.locationId,
        quantity: signedQuantity,
        reason: trimmedReason,
      });
      toast.success("Existencias ajustadas", {
        description: `${site.name}: ${signedQuantity > 0 ? "+" : ""}${signedQuantity} unidades`,
      });
      onClose();
    } catch (error) {
      toast.error("No se pudo ajustar las existencias", {
        description: getApiErrorMessage(error, "Revisa la sede y la cantidad."),
      });
    }
  };

  // The dialog is opened from inside the product editor, which is itself a
  // `<form>` inside a disabled-capable `<fieldset>`. Rendering it into the body
  // keeps that out: no nested form, no submit button of a dialog that inherits
  // the editor's disabled state.
  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <Modal isOpen onClose={close} title="Ajustar existencias" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {productName
            ? `Mueve las unidades de ${productName} en una sola sede. El ajuste queda en el historial de inventario.`
            : "Mueve las unidades de una sola sede. El ajuste queda en el historial de inventario."}
        </p>

        <Select
          label="Sede"
          placeholder="Elige la sede"
          options={siteOptions}
          value={locationId}
          onChange={setLocationId}
        />

        {site && (
          <p className="text-[13px] tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{site.stock} uds.</span>{" "}
            en la sede · {site.reservedStock} reservadas ·{" "}
            <span className="font-medium text-foreground">
              {site.availableStock} disponibles
            </span>
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">
              Tipo de ajuste
            </p>
            <div
              role="group"
              aria-label="Tipo de ajuste"
              className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5"
            >
              {(
                [
                  { value: "in", label: "Entrada" },
                  { value: "out", label: "Salida" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={direction === option.value}
                  onClick={() => setDirection(option.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    direction === option.value
                      ? "bg-card text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">
              Cantidad
            </p>
            <div role="group" aria-label="Cantidad">
              <Stepper
                value={effectiveQuantity}
                min={1}
                max={maxQuantity}
                disabled={withdrawingNothing || adjust.isPending}
                onChange={setQuantity}
              />
            </div>
          </div>
        </div>

        {withdrawingNothing && (
          <p role="alert" className="text-[13px] font-medium text-danger-text">
            Esta sede no tiene unidades disponibles para retirar.
          </p>
        )}

        <Input
          label="Motivo"
          required
          maxLength={MAX_REASON_LENGTH}
          placeholder="Conteo físico, merma, corrección…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={adjust.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSubmit} loading={adjust.isPending}>
            Guardar ajuste
          </Button>
        </div>
      </form>
    </Modal>,
    document.body,
  );
}
