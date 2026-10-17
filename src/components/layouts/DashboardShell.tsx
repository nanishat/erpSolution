"use client";

// TODO(Phase 7 — Roles/Audit Trail/Multi-Branch): once User.role exists, this
// is where role-based visibility belongs — e.g. filtering `navGroups` (or a
// group's `items`) by role before rendering, or gating an entire NavGroup
// behind a permission check. Nothing here does that yet: every item below is
// visible to everyone, regardless of identity.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/layouts/Breadcrumbs";
import { dashboardNavItem, navGroups, type NavGroup, type NavItem } from "./nav-config";

function isActiveHref(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(`${href}/`);
}

function getActiveNavItem(pathname: string | null): NavItem | null {
  if (!pathname || pathname === dashboardNavItem.href) {
    return null;
  }

  return navGroups
    .flatMap((group) => group.items)
    .filter((item) => isActiveHref(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

function getActiveGroup(pathname: string | null): NavGroup | undefined {
  const activeItem = getActiveNavItem(pathname);
  return navGroups.find((group) =>
    group.items.some((item) => item.href === activeItem?.href)
  );
}

function getInitialCollapsedGroups(pathname: string | null) {
  const activeGroup = getActiveGroup(pathname);
  return new Set(
    navGroups
      .filter(
        (group) =>
          (group.label === "Reports" || group.label === "Setup") &&
          group.label !== activeGroup?.label
      )
      .map((group) => group.label)
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    getInitialCollapsedGroups(pathname)
  );
  const activeItem = getActiveNavItem(pathname);
  const activeGroup = getActiveGroup(pathname);

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

  useEffect(() => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);

      for (const label of ["Reports", "Setup"]) {
        if (activeGroup?.label === label) {
          next.delete(label);
        } else {
          next.add(label);
        }
      }

      if (activeGroup) {
        next.delete(activeGroup.label);
      }

      return next;
    });
  }, [activeGroup, pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-muted/30 p-4">
        <p className="mb-4 text-sm font-semibold">ERP Solution</p>
        <nav className="flex flex-col gap-3">
          <Link
            href={dashboardNavItem.href}
            aria-current={pathname === dashboardNavItem.href ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
              pathname === dashboardNavItem.href && "bg-primary/10 font-medium text-primary"
            )}
          >
            {dashboardNavItem.label}
          </Link>
          {navGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.label);

            return (
              <div key={group.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={!isCollapsed}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {group.label}
                </button>
                {!isCollapsed && (
                  <div className="flex flex-col gap-1">
                    {group.items.map((item) => {
                      const isActive = activeItem?.href === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                            isActive && "bg-primary/10 font-medium text-primary"
                          )}
                        >
                          {item.label}
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
        <main className="flex-1 p-6">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
