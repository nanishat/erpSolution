"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useBankStatementLineActions } from "@/modules/bank-reconciliation/hooks/useBankStatementLineActions";
import type {
  BankStatementLineDTO,
  MatchCandidate,
} from "@/modules/bank-reconciliation/services/bank-reconciliation.service";

type StatusFilter = "ALL" | "UNMATCHED" | "MATCHED" | "IGNORED";

const FILTERS: StatusFilter[] = ["ALL", "UNMATCHED", "MATCHED", "IGNORED"];

const FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "All",
  UNMATCHED: "Unmatched",
  MATCHED: "Matched",
  IGNORED: "Ignored",
};

/**
 * Every button below fires exactly one explicit, single-line action
 * (confirm THIS candidate against THIS line, ignore THIS line, ...) — there
 * is no "match all"/"auto-apply" control anywhere here, per the manual-first
 * convention already locked for Cash Voucher direction and PartnerCredit
 * application. `lines`/`suggestionsByLineId` arrive already Number(...)-
 * serialized (no Prisma Decimal) from the server page above.
 */
export function BankStatementLineList({
  bankStatementId,
  lines,
  suggestionsByLineId,
}: {
  bankStatementId: string;
  lines: BankStatementLineDTO[];
  suggestionsByLineId: Record<string, MatchCandidate[]>;
}) {
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const { pendingLineId, handleConfirmMatch, handleUnmatch, handleIgnore, handleUnignore } =
    useBankStatementLineActions(bankStatementId);

  const filteredLines = filter === "ALL" ? lines : lines.filter((line) => line.matchStatus === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const count = option === "ALL" ? lines.length : lines.filter((l) => l.matchStatus === option).length;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                filter === option ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
              }`}
            >
              {`${FILTER_LABELS[option]} (${count})`}
            </button>
          );
        })}
      </div>

      {filteredLines.length === 0 && <p className="text-sm text-muted-foreground">No lines with this status.</p>}

      <div className="space-y-3">
        {filteredLines.map((line) => {
          const isPending = pendingLineId === line.id;
          const candidates = suggestionsByLineId[line.id] ?? [];

          return (
            <div key={line.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{line.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {`${new Date(line.date).toLocaleDateString()} · Ref: ${line.referenceNo ?? "—"}`}
                  </div>
                </div>
                <div className={`text-sm font-medium ${line.amount < 0 ? "text-destructive" : ""}`}>
                  {line.amount.toFixed(2)}
                </div>
              </div>

              {line.matchStatus === "UNMATCHED" && (
                <div className="mt-3 space-y-2">
                  {candidates.length === 0 && (
                    <p className="text-xs text-muted-foreground">No matching journal lines found.</p>
                  )}
                  {candidates.map((candidate) => (
                    <div
                      key={candidate.journalLineId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs"
                    >
                      <span>
                        {`${candidate.documentNumber} — ${candidate.description} (${new Date(candidate.date).toLocaleDateString()}, Dr ${candidate.debit.toFixed(2)} / Cr ${candidate.credit.toFixed(2)})`}
                      </span>
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
                  ))}
                  <div>
                    <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => handleIgnore(line.id)}>
                      Ignore
                    </Button>
                  </div>
                </div>
              )}

              {line.matchStatus === "MATCHED" && line.matchedJournalLine && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                  <span>
                    {`Matched to ${line.matchedJournalLine.documentNumber} — ${line.matchedJournalLine.description} (${new Date(line.matchedJournalLine.date).toLocaleDateString()}, Dr ${line.matchedJournalLine.debit.toFixed(2)} / Cr ${line.matchedJournalLine.credit.toFixed(2)})`}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleUnmatch(line.id)}
                  >
                    Unmatch
                  </Button>
                </div>
              )}

              {line.matchStatus === "IGNORED" && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Ignored — excluded from matching.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleUnignore(line.id)}
                  >
                    Unignore
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
