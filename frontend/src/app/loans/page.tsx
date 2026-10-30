"use client";

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, HandCoins, Wrench } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useCollectLoan,
  useCompletePosLoan,
  useLoan,
  useLoanHistory,
  useLoans,
} from "@/hooks/useLoans";
import { Badge } from "@/components/ui/Badge";
import { BentoSelect } from "@/components/ui/BentoSelect";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  FilterBar,
  FilterClearButton,
  FilterGroup,
  FilterOptionButton,
} from "@/components/ui/FilterBar";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Table, TableCell, TableHeader, TableRow } from "@/components/ui/Table";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { usePersistedViewMode } from "@/hooks/usePersistedViewMode";
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
 * A loan the projection marks as POS financing can only be completed while it is
 * still open and once its balance is fully paid. An ordinary loan carries no
 * `posFinancing`, and a closed one has nothing left to complete.
 */
function canCompletePosLoan(loan: Loan): boolean {
  return (
    loan.status === "OPEN" &&
    Boolean(loan.posFinancing) &&
    toFiniteNumber(loan.balance) === 0
  );
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
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 p-3">
      <dt className="text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd
        data-testid={testId}
        className="mt-1 truncate text-xs sm:text-sm font-semibold text-foreground"
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
  const hasBalance = emphasis && toFiniteNumber(value) > 0;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border px-2.5 py-2",
        emphasis
          ? "border-border/80 bg-muted/50"
          : "border-border/50 bg-muted/25",
      )}
    >
      <p className="text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-xs font-semibold tabular-nums",
          hasBalance
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground",
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
    <Card onClick={onOpen} className="flex h-full flex-col justify-between p-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground">
              <TypeIcon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground leading-tight">
                {counterpartyName(loan)}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                {TYPE_LABELS[loan.type]}
              </p>
            </div>
          </div>
          <Badge variant={STATUS_VARIANTS[loan.status]} dot>
            {STATUS_LABELS[loan.status]}
          </Badge>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/50 pt-3">
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
  const [viewMode, setViewMode] = usePersistedViewMode("loans");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | MonetaryLoanType>("");
  const [statusFilter, setStatusFilter] = useState<"" | MoneyLoanStatus>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [method, setMethod] = useState<CollectLoanInput["method"]>("CASH");
  // An attempt is pinned to the exact payload it was minted for: a retry of an
  // uncertain failure reuses its key, while a corrected amount, method or loan
  // mints a new one.
  const collectAttemptRef = useRef<{ key: string; signature: string } | null>(
    null,
  );
  const completeAttemptRef = useRef<{ key: string; signature: string } | null>(
    null,
  );

  const pageSize = 10;

  const loansQuery = useLoans(
    typeFilter
      ? { page, limit: pageSize, type: typeFilter }
      : { page, limit: pageSize },
  );
  const loanQuery = useLoan(selectedId ?? "");
  const historyQuery = useLoanHistory(selectedId ?? "");
  const collectLoan = useCollectLoan();
  const completePosLoan = useCompletePosLoan();

  const rawLoans = useMemo(() => loansQuery.data?.data ?? [], [loansQuery.data]);
  const loans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawLoans.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (!q) return true;
      const party = counterpartyName(item).toLowerCase();
      const reason = (item.reason ?? "").toLowerCase();
      return party.includes(q) || reason.includes(q);
    });
  }, [rawLoans, search, statusFilter]);
  const loan = loanQuery.data ?? null;
  const history = historyQuery.data?.data ?? [];

  const handleCollect = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !amount || amount <= 0) {
      toast.error("Ingrese un monto válido");
      return;
    }
    const signature = `${selectedId}|${amount}|${method}`;
    const attempt =
      collectAttemptRef.current?.signature === signature
        ? collectAttemptRef.current
        : { key: crypto.randomUUID(), signature };
    collectAttemptRef.current = attempt;
    try {
      await collectLoan.mutateAsync({
        id: selectedId,
        amount,
        method,
        requestKey: attempt.key,
      });
      if (collectAttemptRef.current === attempt) collectAttemptRef.current = null;
      setAmount(undefined);
      toast.success("Abono registrado");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo registrar el abono"));
    }
  };

  const handleComplete = async () => {
    if (!selectedId || !loan || !canCompletePosLoan(loan)) return;
    const signature = selectedId;
    const attempt =
      completeAttemptRef.current?.signature === signature
        ? completeAttemptRef.current
        : { key: crypto.randomUUID(), signature };
    completeAttemptRef.current = attempt;
    try {
      // The frozen quote already lives on the server: only the idempotency key
      // travels, never items, totals or a sale id.
      await completePosLoan.mutateAsync({
        id: selectedId,
        requestKey: attempt.key,
      });
      if (completeAttemptRef.current === attempt) completeAttemptRef.current = null;
      toast.success("Venta financiada completada");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "No se pudo completar la venta"));
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 lg:min-h-[calc(100vh-4rem)] lg:gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Préstamos
              </h1>
              {loansQuery.data?.total !== undefined && (
                <span className="hidden sm:inline-flex items-center rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                  {loansQuery.data.total} registros
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Obligaciones activas y ventas financiadas desde caja
            </p>
          </div>
        </div>

        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por contraparte o motivo..."
          filterControls={
            <>
              <BentoSelect
                value={statusFilter}
                onChange={(val) => setStatusFilter(val as "" | MoneyLoanStatus)}
                placeholder="Todos los estados"
                className="w-full sm:w-44 shrink-0"
                options={[
                  { value: "", label: "Todos los estados" },
                  { value: "OPEN", label: "Abierto" },
                  { value: "CLOSED", label: "Cerrado" },
                  { value: "CANCELLED", label: "Cancelado" },
                ]}
              />
              <FilterGroup label="Tipo">
                {(
                  [
                    { value: "", label: "Todos" },
                    { value: "MONEY", label: "En efectivo" },
                    { value: "SERVICE", label: "Servicios" },
                  ] as const
                ).map((opt) => (
                  <FilterOptionButton
                    key={opt.value}
                    active={typeFilter === opt.value}
                    onClick={() => {
                      setPage(1);
                      setTypeFilter(opt.value);
                    }}
                  >
                    {opt.label}
                  </FilterOptionButton>
                ))}
              </FilterGroup>
              {(typeFilter || statusFilter || search) && (
                <FilterClearButton
                  onClick={() => {
                    setPage(1);
                    setTypeFilter("");
                    setStatusFilter("");
                    setSearch("");
                  }}
                />
              )}
              <ViewModeToggle
                value={viewMode}
                onChange={(mode) => {
                  setPage(1);
                  setViewMode(mode);
                }}
              />
            </>
          }
        />

        <div className="flex flex-1 flex-col gap-4">
          {loansQuery.isLoading ? (
            <LoadingState
              icon={<HandCoins className="h-4 w-4 text-muted-foreground" />}
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
          ) : viewMode === "table" ? (
            <div className="flex-1 overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs animate-fade-in">
              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableCell as="th">Contraparte</TableCell>
                      <TableCell as="th">Tipo</TableCell>
                      <TableCell as="th">Estado</TableCell>
                      <TableCell as="th" className="text-right">
                        Monto
                      </TableCell>
                      <TableCell as="th" className="text-right">
                        Abonado
                      </TableCell>
                      <TableCell as="th" className="text-right">
                        Saldo
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <tbody>
                    {loans.map((row) => (
                      <TableRow
                        key={row.id}
                        data-testid="loan-row"
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedId(row.id);
                          setAmount(undefined);
                        }}
                      >
                        <TableCell>
                          <span className="text-xs font-medium text-foreground truncate">
                            {counterpartyName(row)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {TYPE_LABELS[row.type]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANTS[row.status]} dot>
                            {STATUS_LABELS[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-foreground tabular-nums">
                          {money(row.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                          {money(row.collected)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                          <span
                            className={
                              toFiniteNumber(row.balance) > 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-foreground"
                            }
                          >
                            {money(row.balance)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          ) : (
            <ul
              data-testid="loan-cards"
              className="grid flex-1 content-start grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger-children"
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

          <Pagination
            currentPage={loansQuery.data?.page ?? page}
            totalPages={loansQuery.data?.totalPages ?? 0}
            totalItems={loansQuery.data?.total}
            pageSize={pageSize}
            itemLabel="préstamo"
            onPageChange={setPage}
          />
        </div>
      </div>

      <Modal
        isOpen={selectedId !== null}
        onClose={() => {
          setSelectedId(null);
          setAmount(undefined);
        }}
        title="Detalle del préstamo"
        size="lg"
        footer={
          loan && loan.status === "OPEN" ? (
            <form onSubmit={handleCollect} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Nuevo abono
                </span>
                {toFiniteNumber(loan.balance) > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setAmount(toFiniteNumber(loan.balance))}
                  >
                    Pagar saldo restante
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CurrencyInput
                  label="Monto del abono"
                  value={amount}
                  onChange={setAmount}
                />
                <Select
                  label="Método"
                  options={METHOD_OPTIONS}
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as CollectLoanInput["method"])
                  }
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
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
                <Button
                  type="submit"
                  loading={collectLoan.isPending}
                  disabled={toFiniteNumber(loan.balance) <= 0}
                >
                  Registrar abono
                </Button>
              </div>
            </form>
          ) : undefined
        }
      >
        {loanQuery.isLoading ? (
          <LoadingState
            icon={<HandCoins className="h-4 w-4 text-muted-foreground" />}
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
          <div data-testid="loan-detail" className="space-y-4">
            {/* Server-owned money triple. */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {(
                [
                  ["Monto", loan.amount, false],
                  ["Abonado", loan.collected, false],
                  ["Saldo", loan.balance, true],
                ] as const
              ).map(([label, value, isBalance]) => {
                const hasBalance = isBalance && toFiniteNumber(value) > 0;
                return (
                  <div
                    key={label}
                    className={cn(
                      "rounded-lg border p-3.5",
                      isBalance
                        ? "border-border/80 bg-muted/45"
                        : "border-border/60 bg-muted/25",
                    )}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {label}
                    </p>
                    <p
                      className={cn(
                        "mt-1 font-mono text-base sm:text-lg font-semibold tabular-nums",
                        hasBalance
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground",
                      )}
                    >
                      {money(value)}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Everything the projection knows about the loan itself. */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-foreground">
                Datos del préstamo
              </h3>
              <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
              <div
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  loan.status === "CANCELLED"
                    ? "border-rose-500/40 bg-rose-500/[0.06]"
                    : toFiniteNumber(loan.balance) <= 0
                      ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                      : "border-amber-500/40 bg-amber-500/[0.06]",
                )}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Motivo
                  </span>
                  {loan.status === "CANCELLED" ? (
                    <Badge variant="danger" dot>
                      Cancelado
                    </Badge>
                  ) : toFiniteNumber(loan.balance) <= 0 ? (
                    <Badge variant="success" dot>
                      Abonado
                    </Badge>
                  ) : (
                    <Badge variant="warning" dot>
                      Con saldo
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-foreground">
                  {loan.reason}
                </p>
              </div>
            </section>

            {/* The additive POS financing reference, when the loan has one. */}
            {loan.posFinancing && (
              <section
                data-testid="pos-financing"
                className={cn(
                  "rounded-lg border p-3.5",
                  loan.posFinancing.finalSaleId
                    ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                    : "border-amber-500/40 bg-amber-500/[0.06]",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-semibold text-foreground">
                        Venta financiada asociada
                      </h3>
                      <Badge
                        variant={loan.posFinancing.finalSaleId ? "success" : "warning"}
                        dot
                      >
                        {loan.posFinancing.finalSaleId
                          ? "Venta completada"
                          : "Pendiente de vincular"}
                      </Badge>
                    </div>
                    {loan.posFinancing.finalSaleId ? (
                      <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground">
                        Venta vinculada:{" "}
                        <span
                          data-testid="pos-financing-sale"
                          className="inline-flex items-center rounded-md border border-border/70 bg-card px-2 py-0.5 font-mono text-xs font-semibold text-foreground"
                        >
                          {loan.posFinancing.finalSaleNumber != null
                            ? `#${loan.posFinancing.finalSaleNumber}`
                            : "Venta vinculada"}
                        </span>
                      </p>
                    ) : (
                      <p
                        data-testid="pos-financing-pending"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        La venta aún no ha sido vinculada.
                      </p>
                    )}
                  </div>
                  {loan.posFinancing.finalSaleId && (
                    <Link
                      href={`/sales/${loan.posFinancing.finalSaleId}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted"
                    >
                      Ver venta
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </section>
            )}

            {/* Each event carries its own date and author. */}
            <section>
              <h3 className="text-xs font-semibold text-foreground">
                Historial
              </h3>
              {historyQuery.isLoading ? (
                <p
                  data-testid="loan-history-loading"
                  className="mt-2 text-xs text-muted-foreground"
                >
                  Cargando historial...
                </p>
              ) : historyQuery.isError ? (
                <div
                  data-testid="loan-history-error"
                  className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span>No se pudo cargar el historial.</span>
                  <button
                    type="button"
                    className="font-medium text-foreground underline hover:text-primary"
                    onClick={() => void historyQuery.refetch()}
                  >
                    Reintentar
                  </button>
                </div>
              ) : (
                <ul className="mt-2 rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/50 max-h-[min(22rem,42vh)] overflow-y-auto scrollbar-app">
                  {history.map((event) => (
                    <li
                      key={event.id}
                      data-testid="loan-history-row"
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">
                            {EVENT_LABELS[event.type]}
                          </p>
                          {event.method && (
                            <span className="rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                              {METHOD_OPTIONS.find((m) => m.value === event.method)
                                ?.label ?? event.method}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] font-mono text-muted-foreground tabular-nums">
                          <span>{formatDateTime(event.createdAt)}</span>
                          <span className="mx-1.5">·</span>
                          <span className="font-sans">{event.createdBy.name}</span>
                        </p>
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-foreground tabular-nums">
                        {event.amount ? money(event.amount) : event.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
