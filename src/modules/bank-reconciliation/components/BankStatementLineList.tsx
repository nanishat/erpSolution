"use client";

import { Button } from "@/components/ui/button";
import { Amount } from "@/components/shared/Amount";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableBox, Td, Th } from "@/components/shared/TableBox";
import { useBankStatementLineActions } from "@/modules/bank-reconciliation/hooks/useBankStatementLineActions";
import type {
  BankStatementLineDTO,
  MatchCandidate,
} from "@/modules/bank-reconciliation/services/bank-reconciliation.service";

export function BankStatementLineList({
  bankStatementId,
  lines,
  suggestionsByLineId,
  emptyMessage,
}: {
  bankStatementId: string;
  lines: BankStatementLineDTO[];
  suggestionsByLineId: Record<string, MatchCandidate[]>;
  emptyMessage: string;
}) {
  const { pendingLineId, handleConfirmMatch, handleUnmatch, handleIgnore, handleUnignore } =
    useBankStatementLineActions(bankStatementId);

  return (
    <TableBox title="Statement lines">
      {lines.length === 0 ? (
        <EmptyState title={emptyMessage} />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <Th alignment="center">Date</Th>
              <Th>Description</Th>
              <Th alignment="right">Amount</Th>
              <Th alignment="center">Status</Th>
              <Th alignment="center">Action</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const isPending = pendingLineId === line.id;
              const candidates = suggestionsByLineId[line.id] ?? [];

              return (
                <tr key={line.id} className="border-t border-border align-top">
                  <Td alignment="center" className="whitespace-nowrap">
                    {new Date(line.date).toLocaleDateString()}
                  </Td>
                  <Td>
                    <div className="font-medium">{line.description}</div>
                    <div className="text-xs text-muted-foreground">Ref: {line.referenceNo ?? "—"}</div>
                    {line.matchStatus === "MATCHED" && line.matchedJournalLine && (
                      <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                        {`Matched to ${line.matchedJournalLine.documentNumber} — ${line.matchedJournalLine.description} (${new Date(line.matchedJournalLine.date).toLocaleDateString()}, Dr ${line.matchedJournalLine.debit.toFixed(2)} / Cr ${line.matchedJournalLine.credit.toFixed(2)})`}
                      </div>
                    )}
                    {line.matchStatus === "IGNORED" && (
                      <div className="mt-2 text-xs text-muted-foreground">Ignored — excluded from matching.</div>
                    )}
                  </Td>
                  <Td alignment="right"><Amount value={line.amount} /></Td>
                  <Td alignment="center"><StatusBadge status={line.matchStatus} /></Td>
                  <Td className="min-w-64">
                    {line.matchStatus === "UNMATCHED" && (
                      <div className="space-y-2">
                        {candidates.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No matching journal lines found.</p>
                        ) : (
                          candidates.map((candidate) => (
                            <div key={candidate.journalLineId} className="space-y-1 rounded-md bg-muted/50 px-2.5 py-1.5">
                              <p className="text-xs">
                                {`${candidate.documentNumber} — ${candidate.description} (${new Date(candidate.date).toLocaleDateString()}, Dr ${candidate.debit.toFixed(2)} / Cr ${candidate.credit.toFixed(2)})`}
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                onClick={() => handleConfirmMatch(line.id, candidate.journalLineId)}
                              >
                                Confirm match
                              </Button>
                            </div>
                          ))
                        )}
                        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => handleIgnore(line.id)}>
                          Ignore
                        </Button>
                      </div>
                    )}
                    {line.matchStatus === "MATCHED" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleUnmatch(line.id)}
                      >
                        Unmatch
                      </Button>
                    )}
                    {line.matchStatus === "IGNORED" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleUnignore(line.id)}
                      >
                        Unignore
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableBox>
  );
}
