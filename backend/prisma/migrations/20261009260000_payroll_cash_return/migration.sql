-- Actual full reimbursement of payroll cash: the employee returns money that was
-- already paid out. This is a new append-only fact, deliberately separate from
-- PayrollCashRevision (which corrects a mistakenly recorded outflow in place).
-- Neither the original payment, its outflow, its allocations nor its linked
-- expense is rewritten here; a return is added and reported on its own date.
--
-- What protects this evidence, and what does not:
--   * the installment reference is composite on
--     (installmentId, obligationId, outflowId, organizationId, employeeId) and
--     ON DELETE/UPDATE RESTRICT, so the tenant, employee, original payment and
--     original cash outflow cannot be re-keyed or removed while a return exists;
--     the target index "PayrollInstallment_revision_target_key" already exists,
--     so this migration adds no index on PayrollInstallment;
--   * the actor reference is composite on (actorId, organizationId) with
--     ON DELETE/UPDATE RESTRICT, matching the approved decision to retain the
--     actor membership and refuse deleting it while referenced;
--   * the unique index on (installmentId, obligationId, outflowId,
--     organizationId, employeeId) makes a second return of the same installment
--     impossible, because the installment reference forces those columns to its
--     own values; a return covers exactly one complete installment, repeated
--     returns cannot be represented and nothing here supports partial refunds;
--   * a return amount smaller than the original payment is still expressible in
--     this table, so "full" is a writer rule (see below), not a CHECK;
--   * the row-level append-only trigger rejects every ordinary UPDATE and DELETE
--     of a return row;
--   * TRUNCATE and privileged bypass (disabling the trigger,
--     session_replication_role = replica, owner-level DDL) are NOT guarded.
--
-- Not enforced by this migration, and not implemented here:
--   * "full" means the writer must verify that amount equals the returned cash
--     outflow amount and that the stored originalAmount/originalDate/
--     originalMethod match that outflow; a cross-table equality cannot be a
--     CHECK constraint, so it stays a future transactional rule;
--   * the return method is chosen by the actor for the money that comes back
--     (approved decision "¿Con qué medio registramos el dinero que vuelve?" —
--     "Elegir el medio real"); it is required and stored separately from
--     originalMethod so the original payment keeps its own method as evidence;
--   * no route, no report or cash-flow wiring, no expense annulment and no
--     obligation/status transition are added; the completed payment and its
--     linked expense stay unchanged by design.
CREATE TABLE "PayrollCashReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "outflowId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "originalAmount" NUMERIC NOT NULL,
    "originalDate" DATE NOT NULL,
    "originalMethod" "PaymentMethod" NOT NULL,
    "returnMethod" "PaymentMethod" NOT NULL,
    "returnDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollCashReturn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollCashReturn_amount_check" CHECK ("amount" > 0 AND "amount" < 'Infinity'::numeric AND scale("amount") <= 2),
    CONSTRAINT "PayrollCashReturn_originalAmount_check" CHECK ("originalAmount" > 0 AND "originalAmount" < 'Infinity'::numeric AND scale("originalAmount") <= 2),
    CONSTRAINT "PayrollCashReturn_installment_fkey" FOREIGN KEY ("installmentId", "obligationId", "outflowId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollCashReturn_actor_fkey" FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "PayrollCashReturn_installment_key"
    ON "PayrollCashReturn"("installmentId", "obligationId", "outflowId", "organizationId", "employeeId");
CREATE INDEX "PayrollCashReturn_date_idx"
    ON "PayrollCashReturn"("organizationId", "returnDate");

CREATE FUNCTION "protect_payroll_cash_return_history"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payroll cash return history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollCashReturn_history"
BEFORE UPDATE OR DELETE ON "PayrollCashReturn"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_cash_return_history"();
