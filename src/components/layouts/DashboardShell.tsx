"use client";

// TODO(Phase 7 — Roles/Audit Trail/Multi-Branch): once User.role exists, this
// is where role-based visibility belongs — e.g. filtering `navItems` (or a
// group's `items`) by role before rendering, or gating an entire NavGroup
// behind a permission check. Nothing here does that yet: every item below is
// visible to everyone, regardless of identity.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type NavLink = { type: "link"; label: string; href: string };
type NavGroup = { type: "group"; label: string; items: { label: string; href: string }[] };
type NavEntry = NavLink | NavGroup;

// Accounting is a group so future phases (Tax Engine, Invoicing, Payments &
// Reconciliation, Financial Reports, ...) slot in as one more { label, href }
// entry in `items` below — no structural changes to this component needed.
const navItems: NavEntry[] = [
  {
    type: "group",
    label: "Accounting",
    items: [
      // The /accounting landing page is the journal entries list — there's no
      // separate overview/dashboard route (yet), so this doubles as both.
      { label: "Journal Entries", href: "/accounting" },
      { label: "Chart of Accounts", href: "/accounting/chart-of-accounts" },
      { label: "Trial Balance", href: "/accounting/reports/trial-balance" },
      { label: "Customer Invoices", href: "/accounting/invoices" },
      { label: "Vendor Bills", href: "/accounting/vendor-bills" },
      { label: "Partners", href: "/accounting/partners" },
      { label: "Products & Services", href: "/accounting/product-services" },
      { label: "Tax Rates", href: "/accounting/tax-rates" },
    ],
  },
  { type: "link", label: "HR", href: "/hr" },
  { type: "link", label: "Inventory", href: "/inventory" },
];

function isActiveHref(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(`${href}/`);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-muted/30 p-4">
        <p className="mb-4 text-sm font-semibold">ERP Solution</p>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            if (item.type === "link") {
              const isActive = isActiveHref(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted font-medium text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              );
            }

            const isGroupActive = item.items.some((sub) => isActiveHref(pathname, sub.href));
            const isCollapsed = collapsedGroups.has(item.label);

            return (
              <div key={item.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(item.label)}
                  aria-expanded={!isCollapsed}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                    isGroupActive && "font-medium text-foreground"
                  )}
                >
                  {item.label}
                  {isCollapsed ? (
                    <ChevronRight className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
                {!isCollapsed && (
                  <div className="ml-2 flex flex-col gap-1 border-l border-border py-1 pl-2">
                    {item.items.map((sub) => {
                      const isActive = isActiveHref(pathname, sub.href);
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                            isActive && "bg-muted font-medium text-foreground"
                          )}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <span className="text-sm font-semibold">ERP Solution</span>
          {/* Placeholder user slot — no auth wiring yet, see AGENTS.md / session notes. */}
          <span className="text-sm text-muted-foreground">Signed in as ___</span>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
