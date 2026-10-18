import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Alignment = "left" | "right" | "center";

type TableBoxProps = {
  title: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function TableBox({ title, toolbar, footer, children }: TableBoxProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <header className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </header>
      <div className="overflow-x-auto">{children}</div>
      {footer && <footer className="border-t border-border p-5">{footer}</footer>}
    </section>
  );
}

export const tableHeaderClassName =
  "bg-muted/70 border-b border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const tableCellClassName = "px-4 py-3 text-sm";
export const tableRowClassName =
  "border-t border-border transition-colors duration-150 hover:bg-accent/60";

function alignmentClassName(alignment: Alignment) {
  if (alignment === "right") return "text-right tabular-nums";
  if (alignment === "center") return "text-center";
  return "text-left";
}

export function Th({
  alignment = "left",
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { alignment?: Alignment }) {
  return (
    <th
      scope="col"
      className={cn(tableHeaderClassName, alignmentClassName(alignment), className)}
      {...props}
    />
  );
}

export function Td({
  alignment = "left",
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { alignment?: Alignment }) {
  return (
    <td className={cn(tableCellClassName, alignmentClassName(alignment), className)} {...props} />
  );
}
