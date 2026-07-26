"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs = [
  { href: "/accounting/chart-of-accounts", label: "List" },
  { href: "/accounting/chart-of-accounts/tree", label: "Hierarchy" },
  { href: "/accounting/chart-of-accounts/new", label: "New account" },
];

export function ChartOfAccountsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
              isActive && "border-b-2 border-primary font-medium text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
