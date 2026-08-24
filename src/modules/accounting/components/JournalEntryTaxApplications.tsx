import type { JournalEntryWithLines } from "@/modules/accounting/services/journal-entry.service";
import { RemoveTaxApplicationButton } from "@/modules/tax/components/RemoveTaxApplicationButton";

export function JournalEntryTaxApplications({
  taxApplications,
  isDraft,
}: {
  taxApplications: JournalEntryWithLines["taxApplications"];
  isDraft: boolean;
}) {
  if (taxApplications.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">Tax</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Direction</th>
              <th className="px-3 py-2">Partner</th>
              <th className="px-3 py-2 text-right">Rate %</th>
              <th className="px-3 py-2 text-right">Base amount</th>
              <th className="px-3 py-2 text-right">Tax amount</th>
              {isDraft && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {taxApplications.map((app) => (
              <tr key={app.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {app.taxType}
                  {app.sourceTaxRate && (
                    <div className="text-xs text-muted-foreground">{app.sourceTaxRate.name}</div>
                  )}
                </td>
                <td className="px-3 py-2">{app.direction ?? "—"}</td>
                <td className="px-3 py-2">{app.partner?.name ?? "—"}</td>
                <td className="px-3 py-2 text-right">{Number(app.ratePercent).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(app.baseAmount).toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{Number(app.taxAmount).toFixed(2)}</td>
                {isDraft && (
                  <td className="px-3 py-2 text-right">
                    <RemoveTaxApplicationButton id={app.id} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
