"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useJournalEntryActions } from "@/modules/accounting/hooks/useJournalEntryActions";
import type { JournalEntryWithLines } from "@/modules/accounting/types/journal-entry.types";

export function JournalEntryDetailActions({ entry }: { entry: JournalEntryWithLines }) {
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
