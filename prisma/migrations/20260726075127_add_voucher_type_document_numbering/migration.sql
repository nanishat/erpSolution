-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('DEBIT_VOUCHER', 'CREDIT_VOUCHER', 'JOURNAL_VOUCHER', 'CASH_VOUCHER');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "documentNumber" TEXT NOT NULL,
ADD COLUMN     "voucherType" "VoucherType" NOT NULL;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "branchId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "branchId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_voucherType_branchId_yearMonth_key" ON "DocumentSequence"("voucherType", "branchId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_documentNumber_key" ON "JournalEntry"("documentNumber");

-- CreateIndex
CREATE INDEX "JournalLine_branchId_idx" ON "JournalLine"("branchId");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

