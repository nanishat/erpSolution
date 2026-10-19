import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/shared/Card";
import { Amount } from "@/components/shared/Amount";

export type ReportFilters = Record<string, string | undefined>;

function hrefWithFilters(path: string, filters: ReportFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthRange(year: number, month: number) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { from: dateValue(start), to: dateValue(end) };
}

export function ReportQuickLinks({
  path,
  filters,
  asOf = false,
}: {
  path: string;
  filters: ReportFilters;
  asOf?: boolean;
}) {
  const today = new Date();
  const thisMonth = monthRange(today.getFullYear(), today.getMonth());
  const lastMonth = monthRange(today.getFullYear(), today.getMonth() - 1);
  const fiscalStartYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  const fiscalYear = {
    from: `${fiscalStartYear}-07-01`,
    to: `${fiscalStartYear + 1}-06-30`,
  };
  const items = asOf
    ? [
        { label: "Today", values: { asOf: dateValue(today) } },
        {
          label: "End of last month",
          values: { asOf: dateValue(new Date(today.getFullYear(), today.getMonth(), 0)) },
        },
      ]
    : [
        { label: "This Month", values: thisMonth },
        { label: "Last Month", values: lastMonth },
        { label: "This Fiscal Year", values: fiscalYear },
      ];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map(({ label, values }) => {
        const nextFilters = { ...filters };
        if (asOf) {
          delete nextFilters.from;
          delete nextFilters.to;
        } else {
          delete nextFilters.asOf;
        }
        return (
          <Link
            key={label}
            href={hrefWithFilters(path, { ...nextFilters, ...values })}
            className="text-primary underline-offset-4 hover:underline"
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function displayDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function ActiveReportFilters({
  from,
  to,
  asOf,
  branchName,
}: {
  from?: string;
  to?: string;
  asOf?: string;
  branchName?: string;
}) {
  const period = asOf
    ? `As of ${displayDate(asOf)}`
    : from || to
      ? `${displayDate(from) ?? "Beginning"} – ${displayDate(to) ?? "Today"}`
      : "All dates";
  return (
    <p className="text-xs text-muted-foreground">
      {period}
      {branchName ? ` · ${branchName}` : ""}
    </p>
  );
}

export function ReportSummary({
  items,
}: {
  items: { label: string; value: number; status?: ReactNode }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-lg font-semibold">
                <Amount value={item.value} />
              </p>
            </div>
            {item.status}
          </div>
        </Card>
      ))}
    </div>
  );
}

