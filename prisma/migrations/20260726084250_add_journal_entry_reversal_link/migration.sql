-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "reversalOfEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfEntryId_key" ON "JournalEntry"("reversalOfEntryId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfEntryId_fkey" FOREIGN KEY ("reversalOfEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

