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
 *
 * The two halves can disagree about their scope, and say so: the payment mix
 * follows the selected site, while cash adds expense payments, which carry no
 * site and always stay organization-wide.
 */
export function CashPaymentsBlock({
  cash,
  payments,
  cashOrganizationScope = false,
}: {
  cash: ReportQuery<CashFlowReport>;
  payments: ReportQuery<ReportEnvelope<SaleByPaymentMethod[]>>;
  /** A site is selected, so the cash half must state it is still organization-wide. */
  cashOrganizationScope?: boolean;
}) {
  return (
    <SectionShell title="Caja y pagos" icon={Receipt}>
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-0">
        <div className="lg:pr-5">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-muted-foreground">
            Caja
            {cashOrganizationScope && (
              <span
                data-testid="cash-organization-scope"
                className="rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium"
              >
                Valores de toda la organización
              </span>
            )}
          </p>
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
