"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PostableInvoice = { id: string; invoiceNumber: string };

/**
 * Shared Post/Cancel/Reverse handlers for Invoice rows — mirrors
 * useJournalEntryActions (same confirm/fetch/error-handling boilerplate),
 * direction-agnostic so it works for both the Customer Invoice UI (this
 * task) and the future Vendor Bill UI without changes.
 */
export function useInvoiceActions() {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handlePost = async (invoice: PostableInvoice) => {
    if (!window.confirm(`Post ${invoice.invoiceNumber}? This cannot be edited afterward.`)) return;
    setPendingId(invoice.id);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/post`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to post invoice.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const handleCancel = async (invoice: PostableInvoice) => {
    if (!window.confirm(`Cancel ${invoice.invoiceNumber}? This cannot be undone.`)) return;
    setPendingId(invoice.id);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to cancel invoice.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const handleReverse = async (invoice: PostableInvoice) => {
    const reason = window.prompt(
      `Reverse ${invoice.invoiceNumber}? This creates a new offsetting entry and voids this invoice. Optional reason:`
    );
    if (reason === null) return;
    setPendingId(invoice.id);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to reverse invoice.");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  return { pendingId, handlePost, handleCancel, handleReverse };
}
