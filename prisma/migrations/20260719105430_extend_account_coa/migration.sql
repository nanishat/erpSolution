/*
  Warnings:

  - Added the required column `updatedAt` to the `Account` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AccountSubType" AS ENUM ('CURRENT_ASSET', 'FIXED_ASSET', 'BANK', 'CASH', 'RECEIVABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'PAYABLE', 'EQUITY', 'OPERATING_REVENUE', 'OTHER_REVENUE', 'OPERATING_EXPENSE', 'COST_OF_GOODS_SOLD', 'OTHER_EXPENSE');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'BDT',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isReconcilable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "openingBalanceDate" TIMESTAMP(3),
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "subType" "AccountSubType",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Account_branchId_type_idx" ON "Account"("branchId", "type");

-- CreateIndex
CREATE INDEX "Account_parentId_idx" ON "Account"("parentId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
