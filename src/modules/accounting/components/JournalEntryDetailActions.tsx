"use client";

import Link from "next/link";
import type { JournalEntryStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { useJournalEntryActions } from "@/modules/accounting/hooks/useJournalEntryActions";

// Narrowed to exactly what this component reads/passes to
// useJournalEntryActions — no need to carry the full JournalEntryWithLines
// (lines, taxApplications, branch, etc.) across the client boundary just for
// a couple of action buttons.
type JournalEntryActionsEntry = {
  id: string;
  documentNumber: string;
  status: JournalEntryStatus;
  reversalOfEntryId: string | null;
};

export function JournalEntryDetailActions({ entry }: { entry: JournalEntryActionsEntry }) {
  const { pendingId, handlePost, handleReverse } = useJournalEntryActions();
  const isPending = pendingId === entry.id;

  if (entry.status === "VOID") {
    return null;
  }

  return (
    <div className="flex gap-2">
      {entry.status === "DRAFT" && (
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={`/accounting/journal-entries/${entry.id}/edit`}>Edit</Link>
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isPending}
            onClick={() => handlePost(entry)}
          >
            Post
          </Button>
        </>
      )}
      {entry.status === "POSTED" && !entry.reversalOfEntryId && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => handleReverse(entry)}
        >
          Reverse
        </Button>
      )}
    </div>
  );
}
