import { formatAmount } from "@/lib/format-amount";
import { cn } from "@/lib/utils";

export function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", value < 0 && "text-red-600 dark:text-red-400", className)}>
      {formatAmount(value)}
    </span>
  );
}
