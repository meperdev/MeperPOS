-- Additive L3A: keep physical monetary tables and all L1/L2 constraints intact.
CREATE TYPE "MonetaryLoanType" AS ENUM ('MONEY', 'SERVICE');
ALTER TABLE "MoneyLoan"
  ADD COLUMN "type" "MonetaryLoanType" NOT NULL DEFAULT 'MONEY';

-- Pin the discriminator independently of the reviewed principal/party trigger.
-- Existing rows become MONEY; posted history is never rewritten.
CREATE FUNCTION protect_monetary_loan_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'Monetary loan type is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MoneyLoan_type_immutable" BEFORE UPDATE ON "MoneyLoan"
  FOR EACH ROW EXECUTE FUNCTION protect_monetary_loan_type();
