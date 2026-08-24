"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * The only way to correct a mistakenly-added TaxApplication before it posts
 * — there's no reject/review step to fall back on. Only ever rendered while
 * the parent JournalEntry is DRAFT; the service enforces the same
 * restriction independently (JournalEntryNotDraftError otherwise).
 */
export function RemoveTaxApplicationButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleRemove = async () => {
    if (!window.confirm("Remove this tax line?")) return;
    setIsPending(true);
    try {
      const res = await fetch(`/api/tax-applications/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        window.alert(json?.error ?? "Failed to remove tax line.");
        return;
      }
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={handleRemove}>
      Remove
    </Button>
  );
}
