"use client";

import Link from "next/link";
import type { InvoiceStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { useInvoiceActions } from "@/modules/invoicing/hooks/useInvoiceActions";

// Narrowed to exactly what this component reads — no need to carry the full
// InvoiceWithLines (lines, payments, branch, partner, ...) across the client
// boundary just for a few action buttons, mirrors JournalEntryDetailActions.
type InvoiceActionsEntry = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  amountPaid: number;
  basePath: string;
};

/**
 * Status-based action bar for the Invoice detail page — direction-agnostic
 * (works the same for a Customer Invoice or a Vendor Bill), mirrors
 * JournalEntryDetailActions' pattern:
 *   DRAFT: Post, Cancel
 *   POSTED / PARTIALLY_PAID: Record Payment, Reverse (disabled once any
 *     payment exists — amountPaid > 0 — since reverseInvoice rejects that
 *     server-side anyway; this just saves the round trip)
 *   PAID / CANCELLED / VOID: no actions
 */
export function InvoiceDetailActions({ entry }: { entry: InvoiceActionsEntry }) {
  const { pendingId, handlePost, handleCancel, handleReverse } = useInvoiceActions();
  const isPending = pendingId === entry.id;

  if (entry.status === "PAID" || entry.status === "CANCELLED" || entry.status === "VOID") {
    return null;
  }

  return (
    <div className="flex gap-2">
      {entry.status === "DRAFT" && (
        <>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isPending}
            onClick={() => handlePost(entry)}
          >
            Post
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleCancel(entry)}
          >
            Cancel
          </Button>
        </>
      )}
      {(entry.status === "POSTED" || entry.status === "PARTIALLY_PAID") && (
        <>
          <Button asChild variant="default" size="sm">
            <Link href={`${entry.basePath}/${entry.id}/payments/new`}>Record Payment</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || entry.amountPaid > 0}
            title={entry.amountPaid > 0 ? "Cannot reverse an invoice with payments recorded" : undefined}
            onClick={() => handleReverse(entry)}
          >
            Reverse
          </Button>
        </>
      )}
    </div>
  );
}
