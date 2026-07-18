import type { JournalEntryWithLines } from "@/modules/accounting/types/journal-entry.types";

export function JournalEntryTable({ entries }: { entries: JournalEntryWithLines[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No journal entries yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const totalDebit = entry.lines.reduce(
              (sum, line) => sum + Number(line.debit),
              0
            );
            const totalCredit = entry.lines.reduce(
              (sum, line) => sum + Number(line.credit),
              0
            );

            return (
              <tr key={entry.id} className="border-t border-border">
                <td className="px-3 py-2">{entry.date.toLocaleDateString()}</td>
                <td className="px-3 py-2">{entry.description}</td>
                <td className="px-3 py-2">{entry.reference ?? "—"}</td>
                <td className="px-3 py-2">{entry.status}</td>
                <td className="px-3 py-2 text-right">{totalDebit.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{totalCredit.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
