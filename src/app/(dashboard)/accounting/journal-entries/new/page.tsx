import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { JournalEntryTypePicker } from "@/modules/accounting/components/JournalEntryTypePicker";
import { getBranches } from "@/modules/core/services/branch.service";

export const dynamic = "force-dynamic";

export default async function NewJournalEntryPage() {
  const [accounts, branches] = await Promise.all([
    getActiveChartOfAccounts(),
    getBranches(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New journal entry</h1>
        <p className="text-sm text-muted-foreground">
          Record and review journal entries.
        </p>
      </div>

      <JournalEntryTypePicker accounts={accounts} branches={branches} />
    </div>
  );
}
