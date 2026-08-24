/*
  Warnings:

  - You are about to drop the column `status` on the `TaxApplication` table. All the data in the column will be lost.
  - You are about to drop the column `rejectionReason` on the `TaxApplication` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "TaxApplication_status_idx";

-- AlterTable
ALTER TABLE "TaxApplication" DROP COLUMN "status",
DROP COLUMN "rejectionReason";

-- DropEnum
DROP TYPE "TaxApplicationStatus";
