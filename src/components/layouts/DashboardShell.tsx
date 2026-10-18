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
      <aside className="app-sidebar w-60 shrink-0 p-4 text-sidebar-foreground">
        <div className="mb-6 border-b border-sidebar-border px-2 pb-4">
          <p className="text-sm font-semibold tracking-wide">ERP Solution</p>
          <p className="mt-0.5 text-xs text-sidebar-muted">Accounting</p>
        </div>
        <nav className="flex flex-col gap-3">
          <Link
            href={dashboardNavItem.href}
            aria-current={pathname === dashboardNavItem.href ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground",
              pathname === dashboardNavItem.href && "bg-sidebar-active font-medium text-sidebar-foreground"
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
                  className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
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
                            "rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground",
                            isActive && "bg-sidebar-active font-medium text-sidebar-foreground"
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
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <span className="text-sm font-semibold">
            {activeItem?.label ?? dashboardNavItem.label}
          </span>
          {/* Placeholder user slot — no auth wiring yet, see AGENTS.md / session notes. */}
          <div className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
            >
              U
            </span>
            <span className="text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">User</span>
            </span>
          </div>
        </header>
        <main className="flex-1 bg-background">
          <div className="mx-auto w-full max-w-[1400px] p-6">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
