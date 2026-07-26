"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PostableEntry = { id: string; documentNumber: string };

/**
 * Shared Post/Reverse handlers for JournalEntry rows — used by both the list
 * table and the detail page's action bar so the confirm/fetch/error-handling
 * boilerplate isn't duplicated across the two UI surfaces.
 */
export function useJournalEntryActions() {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handlePost = async (entry: PostableEntry) => {
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

  const handleReverse = async (entry: PostableEntry) => {
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

  return { pendingId, handlePost, handleReverse };
}
