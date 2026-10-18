import { formatAmount } from "@/lib/format-amount";
import { cn } from "@/lib/utils";

export function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", value < 0 && "text-danger-foreground", className)}>
      {formatAmount(value)}
    </span>
  );
}
