-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('CUSTOMER', 'VENDOR');

-- AlterTable
-- direction is added nullable first, backfilled below, then locked to NOT
-- NULL — all 19 existing Invoice rows predate Vendor Bill support and are
-- therefore all Customer Invoices by definition (backfilled to CUSTOMER).
ALTER TABLE "Invoice" ADD COLUMN     "direction" "InvoiceDirection",
ALTER COLUMN "sector" DROP NOT NULL;

UPDATE "Invoice" SET "direction" = 'CUSTOMER' WHERE "direction" IS NULL;

ALTER TABLE "Invoice" ALTER COLUMN "direction" SET NOT NULL;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "payableBalance" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VendorBillDocumentSequence" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VendorBillDocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillDocumentSequence_branchId_yearMonth_key" ON "VendorBillDocumentSequence"("branchId", "yearMonth");

-- AddForeignKey
ALTER TABLE "VendorBillDocumentSequence" ADD CONSTRAINT "VendorBillDocumentSequence_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
