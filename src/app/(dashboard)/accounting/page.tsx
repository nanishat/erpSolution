import Link from "next/link";

import { getJournalEntries } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryTable } from "@/modules/accounting/components/JournalEntryTable";
import { Button } from "@/components/ui/button";

// Ledger data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const entries = await getJournalEntries();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Accounting</h1>
          <p className="text-sm text-muted-foreground">
            Record and review journal entries.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/accounting/chart-of-accounts"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Chart of Accounts →
          </Link>
          <Button asChild>
            <Link href="/accounting/journal-entries/new">New journal entry</Link>
          </Button>
        </div>
      </div>
      <JournalEntryTable entries={entries} />
    </div>
  );
}
