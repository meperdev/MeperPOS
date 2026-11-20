"use client";

import { Receipt } from "lucide-react";
import type { ReportEnvelope, CashFlowReport, SaleByPaymentMethod } from "@/types";
import { CashFlowBlock } from "./CashFlowBlock";
import { PaymentMethodsBlock } from "./PaymentMethodsBlock";
import type { ReportQuery } from "./QuerySection";
import { SectionShell } from "./SectionShell";

/**
 * Money in, money out and how it was paid: one full-width card with two halves
 * on wide screens and one column on phones. The two requests stay independent,
 * so a failing cash endpoint still leaves the payment mix readable.
 */
export function CashPaymentsBlock({
  cash,
  payments,
}: {
  cash: ReportQuery<CashFlowReport>;
  payments: ReportQuery<ReportEnvelope<SaleByPaymentMethod[]>>;
}) {
  return (
    <SectionShell title="Caja y pagos" icon={Receipt}>
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-0">
        <div className="lg:pr-5">
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">Caja</p>
          <CashFlowBlock query={cash} />
        </div>
        <div className="border-t border-border/60 pt-4 lg:border-l lg:border-t-0 lg:py-0 lg:pl-5 lg:pr-0">
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">
            Métodos de pago
          </p>
          <PaymentMethodsBlock query={payments} />
        </div>
      </div>
    </SectionShell>
  );
}
