"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shared confirm-match/unmatch/ignore/unignore handlers for the statement
 * detail page's line list — same "fetch, alert on error, router.refresh() on
 * success" shape as useJournalEntryActions. Every call here is triggered by
 * one explicit button click naming a specific line (and, for a match, a
 * specific candidate journal line) — there is no bulk/auto-apply action
 * anywhere in this hook.
 */
export function useBankStatementLineActions(bankStatementId: string) {
  const router = useRouter();
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);

  async function post(action: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/bank-reconciliation/statements/${bankStatementId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      window.alert(json?.error ?? `Failed to ${action} this line.`);
      return false;
    }
    return true;
  }

  async function run(bankStatementLineId: string, action: string, body: Record<string, unknown>) {
    setPendingLineId(bankStatementLineId);
    try {
      if (await post(action, body)) {
        router.refresh();
      }
    } finally {
      setPendingLineId(null);
    }
  }

  const handleConfirmMatch = (bankStatementLineId: string, journalLineId: string) =>
    run(bankStatementLineId, "match", { bankStatementLineId, journalLineId });

  const handleUnmatch = (bankStatementLineId: string) => {
    if (!window.confirm("Unmatch this line? It will return to Unmatched.")) return Promise.resolve();
    return run(bankStatementLineId, "unmatch", { bankStatementLineId });
  };

  const handleIgnore = (bankStatementLineId: string) => run(bankStatementLineId, "ignore", { bankStatementLineId });

  const handleUnignore = (bankStatementLineId: string) =>
    run(bankStatementLineId, "unignore", { bankStatementLineId });

  return { pendingLineId, handleConfirmMatch, handleUnmatch, handleIgnore, handleUnignore };
}
