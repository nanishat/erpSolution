import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function Card({ title, description, children, className }: CardProps) {
  return (
    <section className={cn("space-y-4 rounded-xl border border-border bg-card p-5 shadow-card", className)}>
      {(title || description) && (
        <header className="border-b border-border pb-4">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
