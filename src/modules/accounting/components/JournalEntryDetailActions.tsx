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
  invoice: { id: string; invoiceNumber: string } | null;
};

export function JournalEntryDetailActions({ entry }: { entry: JournalEntryActionsEntry }) {
  const { pendingId, handlePost, handleReverse } = useJournalEntryActions();
  const isPending = pendingId === entry.id;

  if (entry.status === "VOID") {
    return null;
  }

  return (
    <div className="flex gap-2">
      {entry.status === "DRAFT" &&
        (entry.invoice ? (
          // No Invoice detail/list UI exists yet (API-only so far) to link
          // to — plain text until that page ships, rather than a link that
          // 404s. Neither Edit nor Post is offered here: both are rejected
          // at the service layer for an invoice-linked entry (editing would
          // diverge its lines from Invoice.subtotal/lines, posting would
          // skip the Invoice status/Partner balance update) — this is just
          // reflecting that, not the actual enforcement.
          <p className="self-center text-sm text-muted-foreground">
            Belongs to Invoice {entry.invoice.invoiceNumber} — edit/post it from there.
          </p>
        ) : (
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
        ))}
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
