import Link from "next/link";

import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { getJournalEntries } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryForm } from "@/modules/accounting/components/JournalEntryForm";
import { JournalEntryTable } from "@/modules/accounting/components/JournalEntryTable";
import { getBranches } from "@/modules/core/services/branch.service";

// Ledger data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const [entries, accounts, branches] = await Promise.all([
    getJournalEntries(),
    getActiveChartOfAccounts(),
    getBranches(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Accounting</h1>
          <p className="text-sm text-muted-foreground">
            Record and review journal entries.
          </p>
        </div>
        <Link
          href="/accounting/chart-of-accounts"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Chart of Accounts →
        </Link>
      </div>
      <JournalEntryForm accounts={accounts} branches={branches} />
      <JournalEntryTable entries={entries} />
    </div>
  );
}
