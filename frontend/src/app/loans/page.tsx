"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { HandCoins, User, Wrench } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useCollectLoan,
  useCompletePosLoan,
  useLoan,
  useLoanHistory,
  useLoans,
} from "@/hooks/useLoans";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/contexts/ToastContext";
import { getApiErrorMessage } from "@/lib/api";
import { cn, formatCurrency, formatDateTime, toFiniteNumber } from "@/lib/utils";
import type {
  CollectLoanInput,
  Loan,
  MonetaryLoanType,
  MoneyLoanEventType,
  MoneyLoanStatus,
} from "@/types";

const PAGE_SIZE = 10;

const TYPE_LABELS: Record<MonetaryLoanType, string> = {
  MONEY: "Efectivo",
  SERVICE: "Servicio",
};

const STATUS_LABELS: Record<MoneyLoanStatus, string> = {
  OPEN: "Abierto",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
};

const STATUS_VARIANTS: Record<MoneyLoanStatus, "primary" | "success" | "danger"> = {
  OPEN: "primary",
  CLOSED: "success",
  CANCELLED: "danger",
};

const EVENT_LABELS: Record<MoneyLoanEventType, string> = {
  CREATED: "Creado",
  COLLECTED: "Abono",
  REVERSED: "Reversión",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
};

const METHOD_OPTIONS = [
  { value: "CASH", label: "Efectivo" },
  { value: "CARD", label: "Tarjeta" },
  { value: "TRANSFER", label: "Transferencia" },
];

/** The server owns these strings; the client only formats them for display. */
function money(value: string): string {
  return formatCurrency(Number(value));
}

function counterpartyName(loan: Loan): string {
  return (
    loan.customer?.name ??
    loan.supplier?.name ??
    loan.employee?.name ??
    "Sin contraparte"
  );
}

/**
 * A loan the projection marks as POS financing is the only one that can be
 * completed, and only once its balance is fully paid. An ordinary loan carries
 * no `posFinancing`, so this action never appears for it.
 */
function canCompletePosLoan(loan: Loan): boolean {
  return Boolean(loan.posFinancing) && toFiniteNumber(loan.balance) === 0;
}

/** One labelled fact inside the detail modal. */
function DetailField({
  label,
  value,
  testId,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        data-testid={testId}
        className="mt-1 truncate text-sm font-medium text-foreground"
      >
        {value}
      </dd>
    </div>
  );
}

/** One money figure inside a loan card; the balance carries the visual weight. */
function MoneyStat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-xs font-bold tabular-nums sm:text-sm",
          emphasis ? "text-primary" : "text-foreground",
        )}
      >
        {money(value)}
      </p>
    </div>
  );
}

/**
 * One loan as a scannable card: type and status up top, the counterparty below
 * and the server-owned money triple at the foot, mirroring the detail modal.
 */
function LoanCard({ loan, onOpen }: { loan: Loan; onOpen: () => void }) {
  const TypeIcon = loan.type === "MONEY" ? HandCoins : Wrench;

  return (
    <Card onClick={onOpen} className="flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <TypeIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Tipo
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {TYPE_LABELS[loan.type]}
            </p>
          </div>
        </div>
        <Badge variant={STATUS_VARIANTS[loan.status]} dot>
          {STATUS_LABELS[loan.status]}
        </Badge>
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate font-medium text-foreground">
          {counterpartyName(loan)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/40 pt-3">
        <MoneyStat label="Monto" value={loan.amount} />
        <MoneyStat label="Abonado" value={loan.collected} />
        <MoneyStat label="Saldo" value={loan.balance} emphasis />
      </div>
    </Card>
  );
}

export default function LoansPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [method, setMethod] = useState<CollectLoanInput["method"]>("CASH");
  const collectKeyRef = useRef<string | null>(null);
  const completeKeyRef = useRef<string | null>(null);

  const loansQuery = useLoans({ page, limit: PAGE_SIZE });
  const loanQuery = useLoan(selectedId ?? "");
  const historyQuery = useLoanHistory(selectedId ?? "");
  const collectLoan = useCollectLoan();
  const completePosLoan = useCompletePosLoan();

  const loans = loansQuery.data?.data ?? [];
  const loan = loanQuery.data ?? null;
  const history = historyQuery.data?.data ?? [];

  const handleCollect = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !amount || amount <= 0) {
      toast.error("Ingrese un monto válido");
      return;
    }
    // One key per attempt: reused verbatim after an uncertain failure and
    // released only once the server confirms the collection.
    if (!collectKeyRef.current) {
      collectKeyRef.current = crypto.randomUUID();
    }
    try {
      await collectLoan.mutateAsync({
        id: selectedId,
        amount,
        method,
        requestKey: collectKeyRef.current,
      });
      collectKeyRef.current = null;
      setAmount(undefined);
      toast.success("Abono registrado");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo registrar el abono"));
    }
  };

  const handleComplete = async () => {
    if (!selectedId || !loan || !canCompletePosLoan(loan)) return;
    if (!completeKeyRef.current) {
      completeKeyRef.current = crypto.randomUUID();
    }
    try {
      // The frozen quote already lives on the server: only the idempotency key
      // travels, never items, totals or a sale id.
      await completePosLoan.mutateAsync({
        id: selectedId,
        requestKey: completeKeyRef.current,
      });
      completeKeyRef.current = null;
      toast.success("Venta financiada completada");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo completar la venta"));
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1.5 shrink-0 rounded-full bg-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
            Préstamos
          </h1>
        </div>

        <Card className="overflow-hidden">
          {loansQuery.isLoading ? (
            <LoadingState
              icon={<HandCoins className="h-5 w-5 text-primary" />}
              message="Cargando préstamos..."
            />
          ) : loansQuery.isError ? (
            <ErrorState
              message={getApiErrorMessage(
                loansQuery.error,
                "No se pudieron cargar los préstamos",
              )}
              retryLabel="Reintentar"
              onRetry={() => void loansQuery.refetch()}
            />
          ) : loans.length === 0 ? (
            <EmptyState
              icon={<HandCoins className="h-5 w-5 text-muted-foreground" />}
              title="Sin préstamos registrados"
              subtitle="Las obligaciones y las ventas financiadas aparecerán aquí."
            />
          ) : (
            <ul
              data-testid="loan-cards"
              className="stagger-children grid auto-rows-fr grid-cols-1 gap-3.5 p-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4"
            >
              {loans.map((row) => (
                <li key={row.id} data-testid="loan-card" className="min-w-0">
                  <LoanCard
                    loan={row}
                    onOpen={() => {
                      setSelectedId(row.id);
                      setAmount(undefined);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border/60 p-4">
            <Pagination
              currentPage={loansQuery.data?.page ?? page}
              totalPages={loansQuery.data?.totalPages ?? 0}
              totalItems={loansQuery.data?.total}
              pageSize={PAGE_SIZE}
              itemLabel="préstamo"
              onPageChange={setPage}
            />
          </div>
        </Card>
      </div>

      <Modal
        isOpen={selectedId !== null}
        onClose={() => {
          setSelectedId(null);
          setAmount(undefined);
        }}
        title="Detalle del préstamo"
        size="lg"
      >
        {loanQuery.isLoading ? (
          <LoadingState
            icon={<HandCoins className="h-5 w-5 text-primary" />}
            message="Cargando detalle..."
          />
        ) : loanQuery.isError || !loan ? (
          <ErrorState
            message={getApiErrorMessage(
              loanQuery.error,
              "No se pudo cargar el préstamo",
            )}
            retryLabel="Reintentar"
            onRetry={() => void loanQuery.refetch()}
          />
        ) : (
          <div data-testid="loan-detail" className="space-y-6">
            {/* Server-owned money triple. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  ["Monto", loan.amount],
                  ["Abonado", loan.collected],
                  ["Saldo", loan.balance],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl bg-muted/40 p-4 text-center"
                >
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-1 font-mono text-base font-bold tabular-nums text-foreground">
                    {money(value)}
                  </p>
                </div>
              ))}
            </div>

            {/* Everything the projection knows about the loan itself. */}
            <section className="rounded-2xl border border-border/60 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Datos del préstamo
              </h3>
              <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField
                  label="Tipo"
                  value={TYPE_LABELS[loan.type]}
                  testId="loan-type"
                />
                <DetailField
                  label="Estado"
                  value={
                    <Badge variant={STATUS_VARIANTS[loan.status]}>
                      {STATUS_LABELS[loan.status]}
                    </Badge>
                  }
                />
                <DetailField
                  label="Contraparte"
                  value={counterpartyName(loan)}
                  testId="loan-counterparty"
                />
                <DetailField
                  label="Creado por"
                  value={loan.createdBy.name}
                  testId="loan-created-by"
                />
                <DetailField
                  label="Fecha de creación"
                  value={formatDateTime(loan.createdAt)}
                  testId="loan-created-at"
                />
                {loan.dueAt && (
                  <DetailField
                    label="Vencimiento"
                    value={formatDateTime(loan.dueAt)}
                    testId="loan-due-at"
                  />
                )}
              </dl>
              <p className="mt-4 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                {loan.reason}
              </p>
            </section>

            {/* The additive POS financing reference, when the loan has one. */}
            {loan.posFinancing && (
              <section
                data-testid="pos-financing"
                className="rounded-2xl border border-primary/25 bg-primary/5 p-4"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Venta financiada asociada
                </h3>
                {loan.posFinancing.finalSaleId ? (
                  <p className="mt-2 text-sm text-foreground">
                    Venta vinculada:{" "}
                    <span
                      data-testid="pos-financing-sale"
                      className="font-mono font-semibold"
                    >
                      {loan.posFinancing.finalSaleId}
                    </span>
                  </p>
                ) : (
                  <p
                    data-testid="pos-financing-pending"
                    className="mt-2 text-sm text-muted-foreground"
                  >
                    La venta aún no ha sido vinculada.
                  </p>
                )}
              </section>
            )}

            {/* Each event carries its own date and author. */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Historial
              </h3>
              <ul className="mt-2 space-y-2">
                {history.map((event) => (
                  <li
                    key={event.id}
                    data-testid="loan-history-row"
                    className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        {EVENT_LABELS[event.type]}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <span>{formatDateTime(event.createdAt)}</span>
                        <span className="mx-1">·</span>
                        <span>{event.createdBy.name}</span>
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {event.amount ? money(event.amount) : event.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {loan.status === "OPEN" && (
              <form
                onSubmit={handleCollect}
                className="space-y-3 border-t border-border/40 pt-4"
              >
                <CurrencyInput
                  label="Monto del abono"
                  value={amount}
                  onChange={setAmount}
                />
                {toFiniteNumber(loan.balance) > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(toFiniteNumber(loan.balance))}
                  >
                    Pagar saldo restante
                  </Button>
                )}
                <Select
                  label="Método"
                  options={METHOD_OPTIONS}
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as CollectLoanInput["method"])
                  }
                />
                <Button type="submit" loading={collectLoan.isPending}>
                  Registrar abono
                </Button>
              </form>
            )}

            {canCompletePosLoan(loan) && (
              <Button
                type="button"
                variant="success"
                loading={completePosLoan.isPending}
                onClick={() => void handleComplete()}
              >
                Completar venta financiada
              </Button>
            )}
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
