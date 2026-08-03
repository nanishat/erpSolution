/*
  Warnings:

  - Added the required column `direction` to the `TaxRate` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TaxDirection" AS ENUM ('INPUT', 'OUTPUT');

-- CreateEnum
CREATE TYPE "TaxApplicationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "TaxRate" ADD COLUMN     "direction" "TaxDirection" NOT NULL;

-- CreateTable
CREATE TABLE "TaxApplication" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "partnerId" TEXT,
    "taxType" "TaxType" NOT NULL,
    "direction" "TaxDirection",
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "sourceTaxRateId" TEXT,
    "computationType" "TaxComputationType" NOT NULL,
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "status" "TaxApplicationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxApplication_journalEntryId_idx" ON "TaxApplication"("journalEntryId");

-- CreateIndex
CREATE INDEX "TaxApplication_partnerId_idx" ON "TaxApplication"("partnerId");

-- CreateIndex
CREATE INDEX "TaxApplication_status_idx" ON "TaxApplication"("status");

-- AddForeignKey
ALTER TABLE "TaxApplication" ADD CONSTRAINT "TaxApplication_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxApplication" ADD CONSTRAINT "TaxApplication_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxApplication" ADD CONSTRAINT "TaxApplication_sourceTaxRateId_fkey" FOREIGN KEY ("sourceTaxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxApplication" ADD CONSTRAINT "TaxApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
