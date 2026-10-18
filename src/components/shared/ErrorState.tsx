import type { ReactNode } from "react";

type ErrorStateProps = {
  title?: string;
  message?: string;
  retry?: ReactNode;
};

export function ErrorState({
  title = "Something went wrong",
  message,
  retry,
}: ErrorStateProps) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-6 text-center shadow-card">
      <h2 className="text-base font-semibold">{title}</h2>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {retry && <div className="mt-2">{retry}</div>}
    </div>
  );
}
