"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Stepper } from "@/components/ui/Stepper";
import { useLocations } from "@/hooks/useLocations";
import { useProducts } from "@/hooks/useProducts";
import { useCreateTransfer } from "@/hooks/useTransfers";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import type { Product, StockTransfer } from "@/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (transfer: StockTransfer) => void;
}

interface TransferLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  /** Units the origin site can send, read when the line was added. */
  available: number;
}

const EMPTY_FORM = {
  fromLocationId: "",
  toLocationId: "",
  notes: "",
};

const TYPE_LABEL = { STORE: "Sucursal", WAREHOUSE: "Bodega" } as const;

/**
 * Dispatch dialog: stock leaves an authorized origin site and travels to another
 * site of the same organization. Origin and destination are ordinary selects;
 * the lines are picked with the same product search the rest of the app uses.
 */
export function NewTransferModal({ isOpen, onClose, onCreated }: Props) {
  const toast = useToast();
  const create = useCreateTransfer();
  const sites = useLocations();

  const [form, setForm] = useState(EMPTY_FORM);
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [term, setTerm] = useState("");

  // A search field only shows results once it says something: an empty field
  // would otherwise print the whole catalogue under the site selects. Results
  // come from the origin site, so only what that site can send is offered,
  // with that site's available units.
  const searching = term.trim().length > 0 && form.fromLocationId !== "";
  const { data: productsData, isFetching } = useProducts({
    limit: 20,
    search: term.trim() || undefined,
    status: "active",
    available: true,
    locationId: form.fromLocationId || undefined,
    enabled: searching,
  });
  const results = useMemo(() => productsData?.data ?? [], [productsData]);

  const siteOptions: SelectOption[] = (sites.data ?? []).map((site) => ({
    value: site.id,
    label: site.name,
    badge: TYPE_LABEL[site.type],
  }));

  const sameSite =
    form.fromLocationId !== "" &&
    form.fromLocationId === form.toLocationId;

  const canSubmit =
    form.fromLocationId !== "" &&
    form.toLocationId !== "" &&
    !sameSite &&
    lines.length > 0 &&
    lines.every(
      (line) =>
        Number.isInteger(line.quantity) &&
        line.quantity >= 1 &&
        line.quantity <= line.available,
    );

  const reset = () => {
    setForm(EMPTY_FORM);
    setLines([]);
    setTerm("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const addLine = (product: Product) => {
    if (lines.some((line) => line.productId === product.id)) {
      toast.error("Ese producto ya está en la transferencia");
      return;
    }
    setLines((current) => [
      ...current,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: 1,
        available: product.availableStock ?? 0,
      },
    ]);
    setTerm("");
  };

  const setQuantity = (productId: string, quantity: number) =>
    setLines((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, quantity } : line,
      ),
    );

  const removeLine = (productId: string) =>
    setLines((current) =>
      current.filter((line) => line.productId !== productId),
    );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      const created = await create.mutateAsync({
        fromLocationId: form.fromLocationId,
        toLocationId: form.toLocationId,
        notes: form.notes.trim() || undefined,
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
      });
      toast.success("Transferencia despachada", {
        description: `TR-${created.number}`,
      });
      onCreated?.(created);
      reset();
      onClose();
    } catch (error) {
      toast.error("No se pudo despachar la transferencia", {
        description: getApiErrorMessage(
          error,
          "Revisa las sedes y las cantidades.",
        ),
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Nueva transferencia" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          El stock sale de la sede de origen y queda en tránsito hasta que la
          sede de destino lo reciba.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Select
            label="Sede de origen"
            placeholder="Elige la sede de origen"
            options={siteOptions}
            value={form.fromLocationId}
            onChange={(value) => {
              setForm((current) => ({ ...current, fromLocationId: value }));
              // Availability belongs to the origin: its lines start over.
              setLines([]);
            }}
          />
          <ArrowRight
            aria-hidden="true"
            className="mx-auto hidden h-4 w-4 text-muted-foreground sm:block sm:pb-2.5"
          />
          <Select
            label="Sede de destino"
            placeholder="Elige la sede de destino"
            options={siteOptions}
            value={form.toLocationId}
            onChange={(value) =>
              setForm((current) => ({ ...current, toLocationId: value }))
            }
          />
        </div>

        {sameSite && (
          <p role="alert" className="text-[13px] font-medium text-danger-text">
            La sede de origen y la de destino deben ser diferentes.
          </p>
        )}

        <div className="space-y-2">
          <Input
            type="search"
            label="Productos"
            icon={<Search className="h-3.5 w-3.5" />}
            placeholder={
              form.fromLocationId
                ? "Busca un producto por nombre o SKU…"
                : "Elige primero la sede de origen"
            }
            disabled={form.fromLocationId === ""}
            value={term}
            autoComplete="off"
            onChange={(event) => setTerm(event.target.value)}
          />

          {searching && (
            <ul
              role="listbox"
              aria-label="Resultados de productos"
              className="max-h-56 overflow-y-auto rounded-lg border border-border/70 bg-card py-1"
            >
              {results.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {isFetching
                    ? "Buscando productos…"
                    : "Sin resultados para esa búsqueda"}
                </li>
              ) : (
                results.map((product) => {
                  const added = lines.some(
                    (line) => line.productId === product.id,
                  );
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        aria-disabled={added || undefined}
                        onClick={() => addLine(product)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset disabled:opacity-60"
                        disabled={added}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {product.name}
                          </span>
                          <span className="block text-[13px] text-muted-foreground id-text">
                            {product.sku}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-muted-foreground">
                          {added ? (
                            "Agregado"
                          ) : (
                            <>
                              <span className="tabular-nums">
                                {product.availableStock ?? 0} disp.
                              </span>
                              <Plus className="h-4 w-4" />
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState
            className="min-h-[140px]"
            icon={<ArrowRight className="h-5 w-5" />}
            title="Agrega al menos un producto"
            subtitle="Busca el producto arriba y elige la cantidad que viaja."
          />
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card">
            {lines.map((line) => (
              <li
                key={line.productId}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {line.name}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    <span className="id-text">{line.sku}</span>
                    <span className="tabular-nums">
                      {" "}
                      · {line.available} disponibles en origen
                    </span>
                  </p>
                </div>
                <div
                  role="group"
                  aria-label={`Cantidad de ${line.name}`}
                  className="shrink-0"
                >
                  <Stepper
                    value={line.quantity}
                    min={1}
                    max={Math.max(1, line.available)}
                    size="sm"
                    className="[&_input]:w-10"
                    onChange={(value) => setQuantity(line.productId, value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.productId)}
                  aria-label={`Quitar ${line.name}`}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Input
          label="Notas"
          textarea
          rows={2}
          maxLength={500}
          placeholder="Opcional: para qué se traslada la mercancía"
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
        />

        <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSubmit} loading={create.isPending}>
            Despachar transferencia
          </Button>
        </div>
      </form>
    </Modal>
  );
}
