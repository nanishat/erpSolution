import { notFound } from "next/navigation";

import { getActiveChartOfAccounts } from "@/modules/accounting/services/chart-of-account.service";
import { getJournalEntryById } from "@/modules/accounting/services/journal-entry.service";
import { JournalEntryForm } from "@/modules/accounting/components/JournalEntryForm";
import { getBranches } from "@/modules/core/services/branch.service";

export const dynamic = "force-dynamic";

export default async function EditJournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, accounts, branches] = await Promise.all([
    getJournalEntryById(id),
    getActiveChartOfAccounts(),
    getBranches(),
  ]);

  if (!entry) {
    notFound();
  }

  if (entry.status !== "DRAFT") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Edit journal entry</h1>
        <p className="text-sm text-destructive">
          {entry.documentNumber} is {entry.status.toLowerCase()} and can no longer be edited.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Edit journal entry</h1>
        <p className="text-sm text-muted-foreground">{entry.documentNumber}</p>
      </div>

      <JournalEntryForm mode="edit" entry={entry} accounts={accounts} branches={branches} />
    </div>
  );
}
