-- Consolidate the three document-numbering counter tables (DocumentSequence
-- for vouchers, InvoiceDocumentSequence for Customer Invoices,
-- VendorBillDocumentSequence for Vendor Bills) from a per-branch counter to
-- ONE shared counter per document family per month, regardless of branch.
-- The Branch segment is also dropped from the generated document-number
-- string (application-layer change, not part of this migration).
--
-- Per locked decision (2026-09-06): the in-progress month's counters start
-- fresh at 1 rather than resuming from MAX(existing per-branch counters).
-- Existing per-branch rows are therefore dropped rather than merged; this
-- does NOT rename or affect any already-issued document number
-- (JournalEntry.documentNumber / Invoice.invoiceNumber are untouched,
-- immutable historical strings that still contain their original Branch
-- segment). New rows are created lazily, starting at 1, the next time each
-- generator function runs.
--
-- branchId is also dropped from all three tables: a shared counter row
-- cannot coherently point at one branch anymore. This does NOT touch
-- JournalEntry.branchId, JournalLine.branchId, or Invoice.branchId, which
-- remain exactly as-is for branch tracking/reporting.

-- DocumentSequence (vouchers: Debit/Credit/Cash/Journal, plus the
-- Invoice/Vendor Bill/Payment postings that share the same generator)
ALTER TABLE "DocumentSequence" DROP CONSTRAINT "DocumentSequence_branchId_fkey";
DROP INDEX "DocumentSequence_voucherType_branchId_yearMonth_key";
DELETE FROM "DocumentSequence";
ALTER TABLE "DocumentSequence" DROP COLUMN "branchId";
CREATE UNIQUE INDEX "DocumentSequence_voucherType_yearMonth_key" ON "DocumentSequence"("voucherType", "yearMonth");

-- InvoiceDocumentSequence (Customer Invoices)
ALTER TABLE "InvoiceDocumentSequence" DROP CONSTRAINT "InvoiceDocumentSequence_branchId_fkey";
DROP INDEX "InvoiceDocumentSequence_sector_branchId_yearMonth_key";
DELETE FROM "InvoiceDocumentSequence";
ALTER TABLE "InvoiceDocumentSequence" DROP COLUMN "branchId";
CREATE UNIQUE INDEX "InvoiceDocumentSequence_sector_yearMonth_key" ON "InvoiceDocumentSequence"("sector", "yearMonth");

-- VendorBillDocumentSequence (Vendor Bills)
ALTER TABLE "VendorBillDocumentSequence" DROP CONSTRAINT "VendorBillDocumentSequence_branchId_fkey";
DROP INDEX "VendorBillDocumentSequence_branchId_yearMonth_key";
DELETE FROM "VendorBillDocumentSequence";
ALTER TABLE "VendorBillDocumentSequence" DROP COLUMN "branchId";
CREATE UNIQUE INDEX "VendorBillDocumentSequence_yearMonth_key" ON "VendorBillDocumentSequence"("yearMonth");
