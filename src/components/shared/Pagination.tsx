import Link from "next/link";

import { buildQueryString, type ListSearchParams } from "@/lib/list-params";

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  searchParams: ListSearchParams;
};

const PAGE_SIZES = [10, 25, 50] as const;

export function Pagination({ page, pageSize, total, searchParams }: PaginationProps) {
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const pageCount = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        Showing {firstItem}–{lastItem} of {total}
      </p>
      {total > pageSize && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <nav aria-label="Pagination" className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={buildQueryString(searchParams, { page: String(page - 1) })}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-primary hover:bg-muted"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground">Previous</span>
            )}
            <span className="text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link
                href={buildQueryString(searchParams, { page: String(page + 1) })}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-primary hover:bg-muted"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground">Next</span>
            )}
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows per page:</span>
            {PAGE_SIZES.map((size) => (
              <Link
                key={size}
                href={buildQueryString(searchParams, {
                  page: "1",
                  pageSize: String(size),
                })}
                aria-current={size === pageSize ? "page" : undefined}
                className={
                  size === pageSize
                    ? "rounded-lg border border-primary bg-primary px-2.5 py-1 font-semibold text-primary-foreground"
                    : "rounded-lg border border-border bg-card px-2.5 py-1 text-foreground hover:bg-muted"
                }
              >
                {size}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
