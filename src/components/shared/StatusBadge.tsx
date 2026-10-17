import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  POSTED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  PAID: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  RECONCILED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  MATCHED: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  VOID: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  REVERSED: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  OVERDUE: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
};

export function humanizeStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {humanizeStatus(status)}
    </span>
  );
}
