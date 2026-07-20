import { getActiveAccounts } from "@/modules/accounting/services/account.service";
import { getJournalEntries } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryForm } from "@/modules/accounting/components/JournalEntryForm";
import { JournalEntryTable } from "@/modules/accounting/components/JournalEntryTable";

// Ledger data must always be read fresh — never statically prerendered/cached.
export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const [entries, accounts] = await Promise.all([
    getJournalEntries(),
    getActiveAccounts(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Accounting</h1>
        <p className="text-sm text-muted-foreground">
          Record and review journal entries.
        </p>
      </div>
      <JournalEntryForm accounts={accounts} />
      <JournalEntryTable entries={entries} />
    </div>
  );
}
