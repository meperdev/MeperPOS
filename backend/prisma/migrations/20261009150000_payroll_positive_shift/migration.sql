-- Existing zero-value shifts remain without validation or data changes.
-- NOT VALID enforces the check on inserts and all subsequent updates, so an
-- existing zero-value shift cannot be updated until its amount is positive.
ALTER TABLE "EmployeeShift"
ADD CONSTRAINT "EmployeeShift_amount_positive_check"
CHECK ("amount" > 0) NOT VALID;
