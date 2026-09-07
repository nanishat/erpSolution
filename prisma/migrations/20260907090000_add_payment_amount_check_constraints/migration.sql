-- Phase 4, Day 2: DB-level CHECK constraints backing the Zod
-- positive-amount validation on the new Payment/PaymentAllocation/
-- PartnerCredit/CreditApplication tables (payment.service.ts,
-- payment.schema.ts) — "reject negative/zero at Zod AND DB" per this task's
-- validation-layer requirement. First CHECK constraints in this repo (none
-- existed anywhere in prior migrations, including TaxRate/TaxApplication's
-- ratePercent — that path is Zod-only today); introduced here rather than
-- retrofitted onto older tables, which is out of scope for this task.
--
-- Written and applied by hand (not via `prisma migrate dev`): the shadow
-- database `prisma migrate dev` needs to validate a new migration cannot be
-- built from this repo's migration history — a pre-existing, already
-- documented gap (see 20260902113433_remove_orphaned_depreciation_
-- scaffolding's own header: an earlier migration's SQL file is missing from
-- the repo, leaving the VoucherType enum unreproducible from scratch). Not
-- touched here; flagged separately.
--
-- remainingAmount on PartnerCredit is allowed to be exactly 0 (a fully-
-- applied credit) so its CHECK is >= 0, not > 0, unlike every other amount
-- column here.

BEGIN;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "PaymentAllocation"
  ADD CONSTRAINT "PaymentAllocation_amountApplied_positive" CHECK ("amountApplied" > 0);

ALTER TABLE "PartnerCredit"
  ADD CONSTRAINT "PartnerCredit_originalAmount_positive" CHECK ("originalAmount" > 0);

ALTER TABLE "PartnerCredit"
  ADD CONSTRAINT "PartnerCredit_remainingAmount_nonnegative" CHECK ("remainingAmount" >= 0);

ALTER TABLE "CreditApplication"
  ADD CONSTRAINT "CreditApplication_amountApplied_positive" CHECK ("amountApplied" > 0);

COMMIT;
