-- Removes orphaned Phase 4.5 depreciation scaffolding. `DepreciationEntry`/
-- `DepreciationRun` and the `DEPRECIATION_VOUCHER` VoucherType value were
-- applied to the dev DB by migration 20260825105420_add_depreciation_models,
-- whose SQL file is missing from the repo and whose models were never added
-- to schema.prisma — no depreciation-posting service/API was ever built on
-- top of them. Decision: delete this scaffolding rather than restore it;
-- Phase 4.5 will be redesigned from scratch later, not resumed from this.
--
-- Verified before writing this migration: 5 JournalEntry rows
-- (voucherType = 'DEPRECIATION_VOUCHER', all created within the same second
-- on 2026-08-25, DEP/HO/... document numbers), 10 JournalLine rows, 8
-- DepreciationEntry rows, 5 DepreciationRun rows, and zero references from
-- Invoice/Payment/TaxApplication or the JournalEntry reversal self-relation.
-- FixedAsset itself is untouched — it's a real, schema-declared model with
-- real data; only DepreciationEntry/DepreciationRun (absent from
-- schema.prisma) are dropped here.
--
-- The DEPRECIATION_VOUCHER label stays defined on the VoucherType Postgres
-- enum type itself (Postgres has no DROP VALUE for enums short of
-- recreating the type) but is no longer referenced by any row after this
-- migration, and is not present in schema.prisma's VoucherType, so it can
-- never be produced again by application code.

BEGIN;

DROP TABLE IF EXISTS "DepreciationEntry";
DROP TABLE IF EXISTS "DepreciationRun";

DELETE FROM "JournalLine" WHERE "journalEntryId" IN (
  SELECT id FROM "JournalEntry" WHERE "voucherType" = 'DEPRECIATION_VOUCHER'
);

DELETE FROM "JournalEntry" WHERE "voucherType" = 'DEPRECIATION_VOUCHER';

COMMIT;
