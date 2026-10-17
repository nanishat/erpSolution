import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  POSTED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  PAID: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  RECONCILED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  MATCHED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  FULLY_APPLIED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  IN_PROGRESS: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  PARTIALLY_APPLIED: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  UNMATCHED: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  OPEN: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  VOID: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  REVERSED: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  OVERDUE: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  IMPORTED: "bg-muted text-muted-foreground",
  IGNORED: "bg-muted text-muted-foreground",
  DISPOSED: "bg-muted text-muted-foreground",
  FULLY_DEPRECIATED: "bg-muted text-muted-foreground",
};

export function humanizeStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {label ?? humanizeStatus(status)}
    </span>
  );
}
