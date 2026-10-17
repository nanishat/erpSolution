"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TaxRateDeactivateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const deactivate = async () => {
    if (!window.confirm(`Deactivate "${name}"?`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/tax-rates/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        window.alert(result?.error ?? "Failed to deactivate tax rate.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={deactivate}
      className="text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
    >
      Deactivate
    </button>
  );
}
