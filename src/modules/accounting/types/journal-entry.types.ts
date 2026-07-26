import type { AccountSubType } from "@prisma/client";

export type { JournalEntryWithLines } from "@/modules/accounting/services/journal-entry.service";

export type ChartOfAccountOption = {
  id: string;
  code: string;
  name: string;
  subType: AccountSubType | null;
};
