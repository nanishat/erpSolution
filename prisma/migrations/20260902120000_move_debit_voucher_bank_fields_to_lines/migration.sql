-- Moves Debit Voucher bank detail fields (bankName, chequeNo, chequeDate)
-- from JournalEntry (header, shared across the whole voucher) down to
-- JournalLine (per debit/expense line). Each bill/line paid out of the one
-- shared Cash/Bank account may be paid via a different cheque, so cheque
-- details vary per line even though the paying account does not.
--
-- Verified before writing this migration: 11 total DEBIT_VOUCHER
-- JournalEntry rows, of which exactly 2 (documentNumber DV/HO/202609/0001,
-- DV/HO/202609/0003) have non-null header bank fields — each with 3 debit
-- lines and 1 consolidated credit line, so 6 JournalLine rows receive
-- backfilled data below. The credit line on each is left untouched.

BEGIN;

-- AlterTable: add nullable per-line bank detail columns.
ALTER TABLE "JournalLine" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "chequeNo" TEXT,
ADD COLUMN     "chequeDate" TIMESTAMP(3);

-- Backfill: copy each DEBIT_VOUCHER entry's header bank fields onto every
-- one of its DEBIT lines (debit > 0), never the consolidated credit line.
UPDATE "JournalLine" jl
SET "bankName" = je."bankName",
    "chequeNo" = je."chequeNo",
    "chequeDate" = je."chequeDate"
FROM "JournalEntry" je
WHERE jl."journalEntryId" = je."id"
  AND je."voucherType" = 'DEBIT_VOUCHER'
  AND (je."bankName" IS NOT NULL OR je."chequeNo" IS NOT NULL OR je."chequeDate" IS NOT NULL)
  AND jl."debit" > 0;

-- AlterTable: drop the now-migrated header-level columns.
ALTER TABLE "JournalEntry" DROP COLUMN "bankName",
DROP COLUMN "chequeNo",
DROP COLUMN "chequeDate";

COMMIT;
