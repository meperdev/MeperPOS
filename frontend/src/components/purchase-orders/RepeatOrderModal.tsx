"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Repeat2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useDuplicatePurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import type { PurchaseOrder, SkippedDuplicateItem } from "@/types";

interface RepeatOrderModalProps {
  order: PurchaseOrder;
  isOpen: boolean;
  onClose: () => void;
}

const SKIP_REASON: Record<SkippedDuplicateItem["reason"], string> = {
  INACTIVE: "inactivo",
  NOT_STOCKED: "no maneja inventario",
};

/**
 * "Repetir pedido": the server builds a new draft with this order's products
 * and quantities at their current cost, for the same supplier or another one.
 * Products carry no supplier, so any supplier can take the same list; a
 * different supplier usually means different prices, hence the cost warning.
 */
export function RepeatOrderModal({ order, isOpen, onClose }: RepeatOrderModalProps) {
  const router = useRouter();
  const toast = useToast();
  const duplicate = useDuplicatePurchaseOrder();
  const { data: suppliersData } = useSuppliers({ limit: 200, status: "active" });
  const suppliers = suppliersData?.data ?? [];

  const originalActive = suppliers.some((s) => s.id === order.supplierId);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const supplierId = chosenId ?? (originalActive ? order.supplierId : "");
  const otherSupplier = supplierId !== "" && supplierId !== order.supplierId;

  const handleRepeat = async () => {
    try {
      const { order: draft, skippedItems } = await duplicate.mutateAsync(
        otherSupplier ? { id: order.id, supplierId } : { id: order.id },
      );
      toast.success(`Borrador OC-${draft.orderNumber} creado`);
      if (skippedItems.length > 0) {
        toast.info(
          `Quedaron por fuera: ${skippedItems
            .map((item) => `${item.name} (${SKIP_REASON[item.reason]})`)
            .join(", ")}.`,
        );
      }
      onClose();
      router.push(`/purchase-orders/${draft.id}?edit=1`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo repetir el pedido"));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Repetir pedido OC-${order.orderNumber}`}
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Se crea un borrador con los mismos productos y cantidades, al costo
          actual de cada producto. Podrás ajustarlo antes de confirmarlo.
        </p>

        <Select
          label="Proveedor"
          value={supplierId}
          onChange={setChosenId}
          placeholder="Selecciona un proveedor"
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />

        {!originalActive && suppliersData ? (
          <p className="text-[13px] text-warning-text">
            {order.supplier?.name ?? "El proveedor original"} ya no está activo.
            Elige otro proveedor.
          </p>
        ) : null}
        {otherSupplier ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning-text">
            Revisa los costos: son los de la última compra.
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleRepeat}
            loading={duplicate.isPending}
            disabled={!supplierId || duplicate.isPending}
          >
            <Repeat2 className="h-4 w-4" aria-hidden="true" /> Crear borrador
          </Button>
        </div>
      </div>
    </Modal>
  );
}
