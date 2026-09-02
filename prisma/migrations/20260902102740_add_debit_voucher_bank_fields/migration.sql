-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "chequeNo" TEXT,
ADD COLUMN     "chequeDate" TIMESTAMP(3);
