"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { JournalEntryWithLines } from "@/modules/accounting/types/journal-entry.types";

export function JournalEntryTable({ entries }: { entries: JournalEntryWithLines[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No journal entries yet.</p>;
  }

  const handlePost = async (entry: JournalEntryWithLines) => {
    if (!window.confirm(`Post ${entry.documentNumber}? This cannot be edited afterward.`)) return;
    setPendingId(entry.id);
    try {
      const res = await fetch(`/api/journal-entries/${entry.id}/post`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to post journal entry.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const handleReverse = async (entry: JournalEntryWithLines) => {
    const reason = window.prompt(
      `Reverse ${entry.documentNumber}? This creates a new offsetting entry and voids this one. Optional reason:`
    );
    if (reason === null) return;
    setPendingId(entry.id);
    try {
      const res = await fetch(`/api/journal-entries/${entry.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to reverse journal entry.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Document #</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
            <th className="px-3 py-2 text-right">Actions</th>
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
            const isPending = pendingId === entry.id;

            return (
              <tr key={entry.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">
                  {entry.documentNumber}
                  {entry.reversalOfEntry && (
                    <div className="mt-1 font-sans text-xs text-muted-foreground">
                      Reverses {entry.reversalOfEntry.documentNumber}
                    </div>
                  )}
                  {entry.reversedByEntry && (
                    <div className="mt-1 font-sans text-xs text-muted-foreground">
                      Reversed by {entry.reversedByEntry.documentNumber}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">{entry.date.toLocaleDateString()}</td>
                <td className="px-3 py-2">{entry.description}</td>
                <td className="px-3 py-2">{entry.reference ?? "—"}</td>
                <td className="px-3 py-2">{entry.status}</td>
                <td className="px-3 py-2 text-right">{totalDebit.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{totalCredit.toFixed(2)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {entry.status === "DRAFT" && (
                    <>
                      <Link
                        href={`/accounting/journal-entries/${entry.id}/edit`}
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      >
                        Edit
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-2"
                        disabled={isPending}
                        onClick={() => handlePost(entry)}
                      >
                        Post
                      </Button>
                    </>
                  )}
                  {entry.status === "POSTED" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleReverse(entry)}
                    >
                      Reverse
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
