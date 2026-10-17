"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { dashboardNavItem, navGroups, type NavItem } from "./nav-config";

type Breadcrumb = {
  groupLabel: string;
  item: NavItem;
  pageType?: string;
};

const pageTypeLabels: Record<string, string> = {
  new: "New",
  edit: "Edit",
  import: "Import",
  print: "Print",
  tree: "Tree View",
};

function isPathMatch(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function findItem(pathname: string) {
  return navGroups
    .flatMap((group) =>
      group.items.map((item) => ({ groupLabel: group.label, item }))
    )
    .filter(({ item }) => isPathMatch(pathname, item.href))
    .sort((a, b) => b.item.href.length - a.item.href.length)[0];
}

function getBreadcrumb(pathname: string | null): Breadcrumb | null {
  if (
    !pathname ||
    pathname === dashboardNavItem.href ||
    pathname === "/login"
  ) {
    return null;
  }

  if (
    pathname.startsWith("/accounting/invoices/") ||
    pathname.startsWith("/accounting/vendor-bills/")
  ) {
    if (pathname.endsWith("/payments/new")) {
      const parentPath = pathname.slice(0, -"/payments/new".length);
      const match = findItem(parentPath);
      if (match) {
        return { ...match, pageType: "Record Payment" };
      }
    }
  }

  if (pathname === "/accounting/payments/new") {
    const match = findItem(pathname);
    return match ?? null;
  }

  const suffixMatch = pathname.match(/\/(new|edit|import|print|tree)$/);
  const parentPath = suffixMatch
    ? pathname.slice(0, -suffixMatch[0].length)
    : pathname;
  const match = findItem(parentPath);

  if (!match) {
    return null;
  }

  const relativePath = parentPath.slice(match.item.href.length);
  let pageType = suffixMatch ? pageTypeLabels[suffixMatch[1]] : undefined;

  if (
    !pageType &&
    relativePath &&
    relativePath.split("/").filter(Boolean).length === 1
  ) {
    pageType = "Details";
  }

  return { ...match, pageType };
}

export function Breadcrumbs() {
  const breadcrumb = getBreadcrumb(usePathname());

  if (!breadcrumb) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-5 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-2">
        <li>{breadcrumb.groupLabel}</li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            href={breadcrumb.item.href}
            className="hover:text-foreground"
          >
            {breadcrumb.item.label}
          </Link>
        </li>
        {breadcrumb.pageType && (
          <>
            <li aria-hidden="true">/</li>
            <li>{breadcrumb.pageType}</li>
          </>
        )}
      </ol>
    </nav>
  );
}
