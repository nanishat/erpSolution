import type { JournalEntryWithLines } from "@/modules/accounting/services/journal-entry.service";
import { Amount } from "@/components/shared/Amount";
import { RemoveTaxApplicationButton } from "@/modules/tax/components/RemoveTaxApplicationButton";
import { TableBox, Td, Th } from "@/components/shared/TableBox";

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
    <TableBox title="Tax Applications">
        <table className="w-full">
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Direction</Th>
              <Th>Partner</Th>
              <Th alignment="right">Rate %</Th>
              <Th alignment="right">Base amount</Th>
              <Th alignment="right">Tax amount</Th>
              {isDraft && <Th />}
            </tr>
          </thead>
          <tbody>
            {taxApplications.map((app) => (
              <tr key={app.id} className="border-t border-border">
                <Td>
                  {app.taxType}
                  {app.sourceTaxRate && (
                    <div className="text-xs text-muted-foreground">{app.sourceTaxRate.name}</div>
                  )}
                </Td>
                <Td>{app.direction ?? "—"}</Td>
                <Td>{app.partner?.name ?? "—"}</Td>
                <Td alignment="right">{Number(app.ratePercent).toFixed(2)}</Td>
                <Td alignment="right"><Amount value={Number(app.baseAmount)} /></Td>
                <Td alignment="right"><Amount value={Number(app.taxAmount)} /></Td>
                {isDraft && (
                  <Td alignment="right">
                    <RemoveTaxApplicationButton id={app.id} />
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
    </TableBox>
  );
}
