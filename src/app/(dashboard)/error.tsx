"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/shared/ErrorState";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  function reset() {
    unstable_retry();
  }

  return (
    <ErrorState
      message="An unexpected error occurred. Please try again."
      retry={
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Try again
        </button>
      }
    />
  );
}
