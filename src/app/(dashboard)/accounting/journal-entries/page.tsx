import Link from "next/link";

import { Button } from "@/components/ui/button";
import { JournalEntryTable } from "@/modules/accounting/components/JournalEntryTable";
import { getJournalEntries } from "@/modules/accounting/services/journal-entry.service";

export const dynamic = "force-dynamic";

export default async function JournalEntriesPage() {
  const entries = await getJournalEntries();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Vouchers</h1>
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
          <Link
            href="/accounting/reports/trial-balance"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Trial Balance →
          </Link>
          <Button asChild>
            <Link href="/accounting/journal-entries/new">New Voucher</Link>
          </Button>
        </div>
      </div>
      <JournalEntryTable entries={entries} />
    </div>
  );
}
