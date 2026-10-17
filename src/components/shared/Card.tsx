import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
};

export function Card({ title, description, children }: CardProps) {
  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      {(title || description) && (
        <header>
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}
