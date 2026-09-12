-- Phase 4 (last piece): Bank Reconciliation schema — BankStatement (header)
-- + BankStatementLine (rows), matching against JournalLine (not Payment) so
-- reconciliation is source-agnostic across Payment/Cash Voucher/Debit/Credit
-- Voucher/any other voucher type that posts to a Cash/Bank ChartOfAccount.
--
-- Purely additive: two new enums, two new tables, one new nullable/unique
-- column (BankStatementLine.matchedJournalLineId) on the new table itself.
-- No existing table is altered — ChartOfAccount.isReconcilable already
-- existed (migration 20260719105430_extend_account_coa) and needed no
-- changes; JournalLine gets no new column at all, per the confirmed decision
-- that match state lives entirely on BankStatementLine (JournalLine's
-- reverse relation is a pure Prisma-level back-relation, not a DB column).
--
-- Pre-migration verification (2026-09-08): ChartOfAccount has 111 rows,
-- JournalLine has 1164 rows, User has 0 rows — all untouched by this
-- migration. Only "1010" (Cash) and "1020" (Bank) are currently
-- isReconcilable: true, matching subType CASH/BANK 1:1.
--
-- CHECK constraints follow the precedent set in migration
-- 20260907090000_add_payment_amount_check_constraints: BankStatementLine
-- .amount is signed (positive = inflow, negative = outflow) so its CHECK is
-- <> 0 (a zero-amount line isn't a real bank movement), rather than the
-- strictly-positive CHECK used for Payment/PaymentAllocation/etc.
-- BankStatement.openingBalance/closingBalance get no CHECK at all — bank
-- balances can legitimately be negative (overdraft), same reasoning as
-- Partner.outstandingBalance/payableBalance having no CHECK.
--
-- Written and applied by hand (not via `prisma migrate dev`), same reason as
-- 20260907090000: the pre-existing shadow-DB gap from migration
-- 20260902113433_remove_orphaned_depreciation_scaffolding is untouched here.

BEGIN;

-- CreateEnum
CREATE TYPE "BankStatementStatus" AS ENUM ('IMPORTED', 'IN_PROGRESS', 'RECONCILED');

-- CreateEnum
CREATE TYPE "BankStatementLineMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "closingBalance" DECIMAL(18,2) NOT NULL,
    "status" "BankStatementStatus" NOT NULL DEFAULT 'IMPORTED',
    "importedById" INTEGER,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "bankStatementId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "referenceNo" TEXT,
    "matchStatus" "BankStatementLineMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedJournalLineId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_accountId_idx" ON "BankStatement"("accountId");

-- CreateIndex
CREATE INDEX "BankStatement_status_idx" ON "BankStatement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_matchedJournalLineId_key" ON "BankStatementLine"("matchedJournalLineId");

-- CreateIndex
CREATE INDEX "BankStatementLine_bankStatementId_idx" ON "BankStatementLine"("bankStatementId");

-- CreateIndex
CREATE INDEX "BankStatementLine_matchStatus_idx" ON "BankStatementLine"("matchStatus");

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_bankStatementId_fkey" FOREIGN KEY ("bankStatementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_matchedJournalLineId_fkey" FOREIGN KEY ("matchedJournalLineId") REFERENCES "JournalLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK constraint: signed amount must not be zero (precedent: migration
-- 20260907090000_add_payment_amount_check_constraints)
ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_amount_nonzero" CHECK ("amount" <> 0);

COMMIT;
