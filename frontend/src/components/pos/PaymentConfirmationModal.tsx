"use client";

import { useMemo } from "react";
import Image from "next/image";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Badge } from "@/components/ui/Badge";
import {
  CreditCard,
  DollarSign,
  Smartphone,
  Check,
  Package,
  Trash2,
  Plus,
  User,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type PaymentType = "CASH" | "CARD" | "TRANSFER";
type PaymentMethod = { type: PaymentType; amount: number };

interface CartItem {
  productId: string;
  product: {
    id: string;
    name: string;
    imageUrl: string | null;
    salePrice: number;
  };
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  discountPercent?: number;
  availableStock: number;
}

interface PaymentConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  cart: CartItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  selectedMethod: PaymentType;
  paymentMethods: PaymentMethod[];
  onPaymentMethodChange: (methods: PaymentMethod[]) => void;
  loading?: boolean;
  customerName?: string;
  saleNumber?: number;
}

export function PaymentConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  cart,
  subtotal,
  taxAmount,
  total,
  selectedMethod,
  paymentMethods,
  onPaymentMethodChange,
  loading = false,
  customerName = "Sin cliente",
  saleNumber,
}: PaymentConfirmationModalProps) {
  const methods = useMemo(() => {
    if (paymentMethods.length > 0) {
      return paymentMethods;
    }

    return [{ type: selectedMethod, amount: selectedMethod === "CASH" ? 0 : total }];
  }, [paymentMethods, selectedMethod, total]);

  const setMethods = (nextMethods: PaymentMethod[]) => {
    onPaymentMethodChange(nextMethods);
  };

  const getPaymentMethodLabel = (type: PaymentType) => {
    switch (type) {
      case "CASH":
        return "Efectivo";
      case "CARD":
        return "Tarjeta";
      case "TRANSFER":
        return "Transferencia";
      default:
        return type;
    }
  };

  const getPaymentMethodIcon = (type: PaymentType) => {
    switch (type) {
      case "CASH":
        return <DollarSign className="w-5 h-5" />;
      case "CARD":
        return <CreditCard className="w-5 h-5" />;
      case "TRANSFER":
        return <Smartphone className="w-5 h-5" />;
      default:
        return null;
    }
  };

  const quickCashAmounts = [10000, 20000, 50000, 100000];

  const totalPaid = methods.reduce((sum, method) => sum + method.amount, 0);
  const remaining = Math.max(0, total - totalPaid);
  // Mirrors `SalesService.create` (S3 / D1): a sale may only overpay when the
  // surplus can come back as change, and change only leaves the drawer as cash.
  // Every tender must also be needed — one that could be dropped while the rest
  // still covers the total is an overpayment the customer never made. The preview
  // never sends a change: the server derives and persists it. The surplus is
  // measured in cents, like the server does, so the tax rounding that leaves this
  // total a fraction of a cent away from the persisted one is not read as change.
  const overpay = Math.round((totalPaid - total) * 100) / 100;
  const paymentProblem =
    overpay <= 0
      ? null
      : !methods.some((method) => method.type === "CASH")
        ? "Las tarjetas y transferencias no dan cambio"
        : methods.some((method) => method.amount <= overpay)
          ? "Sobra un pago: con los demás métodos ya se cubre el total"
          : null;
  const change = overpay > 0 && !paymentProblem ? overpay : 0;
  const canConfirm =
    totalPaid >= total &&
    !paymentProblem &&
    methods.some((method) => method.amount > 0);

  const updateMethodAmount = (index: number, amount: number) => {
    const nextMethods = [...methods];
    nextMethods[index] = {
      ...nextMethods[index],
      amount: Number.isFinite(amount) ? Math.max(0, amount) : 0,
    };
    setMethods(nextMethods);
  };

  const addMethod = (type: PaymentType) => {
    if (methods.some((method) => method.type === type)) return;

    const initialAmount = type === "CASH" ? 0 : Math.max(0, remaining);
    setMethods([...methods, { type, amount: initialAmount }]);
  };

  const removeMethod = (index: number) => {
    if (methods.length <= 1) return;
    setMethods(methods.filter((_, currentIndex) => currentIndex !== index));
  };

  const applyExactToCash = () => {
    const cashIndex = methods.findIndex((method) => method.type === "CASH");
    if (cashIndex === -1) {
      setMethods([...methods, { type: "CASH", amount: remaining }]);
      return;
    }

    updateMethodAmount(cashIndex, methods[cashIndex].amount + remaining);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirmar pago" size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Resumen de compra
            </h3>
            <div className="scrollbar-app space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {cart.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-start gap-3 p-3 bg-background rounded-lg border border-border"
                >
                  <div className="relative w-12 h-12 bg-muted/60 border border-border/50 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {item.product.imageUrl ? (
                      <Image
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <Package className="w-5 h-5 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground text-sm truncate">
                      {item.product.name}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatCurrency(item.unitPrice)} x {item.quantity}
                      </span>
                      {item.discountAmount > 0 && (
                        <Badge variant="success" className="text-xs">
                          -{formatCurrency(item.discountAmount)}
                          {item.discountPercent ? ` (${item.discountPercent}%)` : ""}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground text-sm tabular-nums">
                      {formatCurrency(
                        item.quantity * item.unitPrice - item.discountAmount,
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-border flex-wrap">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span>{customerName}</span>
              </div>
              <Badge variant="secondary" className="flex items-center gap-1">
                {getPaymentMethodIcon(selectedMethod)}
                {getPaymentMethodLabel(selectedMethod)}
              </Badge>
              {saleNumber && <Badge variant="secondary">#{saleNumber}</Badge>}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Métodos de pago
            </h3>
            <div className="space-y-2">
              {methods.map((method, index) => (
                <div
                  key={method.type}
                  className="rounded-xl border border-border bg-background p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {getPaymentMethodIcon(method.type)}
                      {getPaymentMethodLabel(method.type)}
                    </div>
                    {methods.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 p-0"
                        onClick={() => removeMethod(index)}
                        aria-label={`Quitar ${getPaymentMethodLabel(method.type)}`}
                      >
                        <Trash2 className="h-4 w-4 text-danger-text" />
                      </Button>
                    )}
                  </div>

                  <CurrencyInput
                    value={method.amount}
                    onChange={(value) => updateMethodAmount(index, value)}
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addMethod("CASH")}
                disabled={methods.some((method) => method.type === "CASH")}
              >
                <Plus className="mr-1 h-4 w-4" /> Efectivo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addMethod("CARD")}
                disabled={methods.some((method) => method.type === "CARD")}
              >
                <Plus className="mr-1 h-4 w-4" /> Tarjeta
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addMethod("TRANSFER")}
                disabled={methods.some((method) => method.type === "TRANSFER")}
              >
                <Plus className="mr-1 h-4 w-4" /> Transferencia
              </Button>
            </div>

            {selectedMethod !== "CASH" && methods.length === 1 && (
              <p className="mt-3 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Se infirió pago exacto para {getPaymentMethodLabel(selectedMethod)}.
                Si deseas pago mixto, agrega otro método y ajusta montos.
              </p>
            )}
          </div>

          {methods.some((method) => method.type === "CASH") && (
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">
                Atajos de efectivo
              </h3>
              <Button
                variant="primary"
                size="lg"
                onClick={applyExactToCash}
                className="mb-3 w-full font-semibold"
                disabled={remaining <= 0}
              >
                <DollarSign className="mr-2 h-5 w-5" />
                Completar con efectivo ({formatCurrency(remaining)})
              </Button>

              <div className="grid grid-cols-4 gap-2">
                {quickCashAmounts.map((amount) => (
                  <Button
                    key={amount}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const cashIndex = methods.findIndex(
                        (method) => method.type === "CASH",
                      );
                      if (cashIndex === -1) return;
                      updateMethodAmount(cashIndex, amount);
                    }}
                    className="text-xs"
                  >
                    {formatCurrency(amount)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-4 border-t border-border bg-background rounded-lg p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Impuestos</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(taxAmount)}
              </span>
            </div>
            <div className="flex justify-between text-sm text-success-text">
              <span>Descuentos</span>
              <span className="font-medium tabular-nums">
                -
                {formatCurrency(
                  cart.reduce((sum, item) => sum + item.discountAmount, 0),
                )}
              </span>
            </div>
            <div className="flex justify-between text-lg font-semibold pt-2 border-t border-border">
              <span className="text-foreground">Total</span>
              <span className="text-primary-text tabular-nums">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Pagado</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(totalPaid)}
              </span>
            </div>
            {remaining > 0 && (
              <div className="flex justify-between text-sm text-warning-text">
                <span>Faltante</span>
                <span className="font-medium tabular-nums">{formatCurrency(remaining)}</span>
              </div>
            )}
            {change > 0 && (
              <div className="flex justify-between text-lg font-semibold text-success-text pt-2 border-t border-border">
                <span>Cambio</span>
                <span className="tabular-nums">{formatCurrency(change)}</span>
              </div>
            )}
          </div>

          {paymentProblem && (
            <p
              role="status"
              className="rounded-lg border border-warning-text/40 bg-warning-text/10 px-3 py-2 text-sm text-warning-text"
            >
              {paymentProblem}
            </p>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={onClose}
              className="flex-1"
              disabled={loading}
            >
              Volver
            </Button>
            <Button
              onClick={onConfirm}
              className="flex-1"
              disabled={!canConfirm || loading}
              loading={loading}
            >
              <Check className="w-5 h-5 mr-2" />
              Confirmar pago
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
