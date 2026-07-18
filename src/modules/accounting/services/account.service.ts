import { db } from "@/lib/db";
import type { AccountOption } from "@/modules/accounting/types/journal-entry.types";

export async function getActiveAccounts(): Promise<AccountOption[]> {
  return db.account.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}
