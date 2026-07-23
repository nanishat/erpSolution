/*
  Warnings:

  - You are about to drop the column `branchId` on the `ChartOfAccount` table. All the data in the column will be lost.
  - Made the column `branchId` on table `JournalEntry` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "ChartOfAccount_branchId_type_idx";

-- AlterTable
ALTER TABLE "ChartOfAccount" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "JournalEntry" ALTER COLUMN "branchId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isHeadOffice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "ChartOfAccount_type_idx" ON "ChartOfAccount"("type");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
