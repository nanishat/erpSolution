-- Phase 4, Day 1 (schema only): extends the Phase 3 minimal single-invoice
-- Payment model (direct `invoiceId` FK, overpayment rejected outright) into
-- multi-invoice allocation plus an auditable overpayment credit ledger, per
-- this conversation's task description (2026-09-06) — no DECISIONS.md exists
-- in this repo to number/cite, so this migration's own header is the record
-- of the decision.
--
-- Pre-migration verification (2026-09-06): "Payment" had 63 rows, all
-- created 2026-08-24..2026-09-06 with no seed-script origin — confirmed with
-- the user to be leftover output of the repo's no-cleanup manual test script
-- convention (see tests/README.md), not real business data, and safe to
-- discard. Those rows are deleted below before the column swap; the
-- JournalEntry/JournalLine rows their postings created are real, balanced
-- ledger data and are left untouched (they simply lose their `payment`
-- back-relation, same as any other voucher-only JournalEntry). "Partner"
-- (123 rows) and "Invoice" (147 rows) are untouched by this migration except
-- for the new "Partner"."creditBalance" column, defaulted to 0 for every
-- existing row.
--
-- Payment: drops the direct 1:1 "invoiceId" FK, adds "partnerId" (a payment
-- now belongs to a Partner, not a single Invoice; direction — customer
-- receipt vs. vendor payment — is inferred from Partner.type, not stored
-- redundantly here).
--
-- PaymentAllocation (new): join table recording how much of a Payment was
-- applied to a given Invoice. Deliberately NO unique constraint on
-- ("paymentId", "invoiceId") — multiple rows for the same pair are allowed
-- (e.g. correction scenarios); sum "amountApplied" across a payment's rows
-- for one invoice to get that invoice's total applied.
--
-- PartnerCredit (new): overpayment ledger. "sourcePaymentId" is unique — at
-- most one credit per overpaying Payment.
--
-- CreditApplication (new): tracks later consumption of a PartnerCredit
-- against an invoice.
--
-- Partner.creditBalance (new): denormalized running total, same pattern as
-- outstandingBalance/payableBalance — updated only by service-layer logic,
-- never a dynamic key.
--
-- Service-layer logic that populates PaymentAllocation/PartnerCredit/
-- CreditApplication and maintains creditBalance is NOT part of this
-- migration (Tuesday's work) — this is schema only.

BEGIN;

-- Discard leftover no-cleanup manual-test Payment rows (confirmed disposable
-- with the user) before the column swap below.
DELETE FROM "Payment";

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('OPEN', 'PARTIALLY_APPLIED', 'FULLY_APPLIED', 'VOID');

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_invoiceId_fkey";

-- DropIndex
DROP INDEX "Payment_invoiceId_idx";

-- AlterTable: Payment loses invoiceId, gains partnerId
ALTER TABLE "Payment" DROP COLUMN "invoiceId";
ALTER TABLE "Payment" ADD COLUMN "partnerId" TEXT NOT NULL;

-- AlterTable: Partner gains the denormalized credit running total
ALTER TABLE "Partner" ADD COLUMN "creditBalance" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountApplied" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCredit" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "sourcePaymentId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "remainingAmount" DECIMAL(18,2) NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditApplication" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountApplied" DECIMAL(18,2) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_partnerId_idx" ON "Payment"("partnerId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCredit_sourcePaymentId_key" ON "PartnerCredit"("sourcePaymentId");

-- CreateIndex
CREATE INDEX "PartnerCredit_partnerId_idx" ON "PartnerCredit"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerCredit_status_idx" ON "PartnerCredit"("status");

-- CreateIndex
CREATE INDEX "CreditApplication_creditId_idx" ON "CreditApplication"("creditId");

-- CreateIndex
CREATE INDEX "CreditApplication_invoiceId_idx" ON "CreditApplication"("invoiceId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCredit" ADD CONSTRAINT "PartnerCredit_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCredit" ADD CONSTRAINT "PartnerCredit_sourcePaymentId_fkey" FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "PartnerCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
