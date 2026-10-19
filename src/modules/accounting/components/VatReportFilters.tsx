import Link from "next/link";

import { Button } from "@/components/ui/button";

type VatReportFiltersProps = {
  from?: string;
  to?: string;
};

function monthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function VatReportFilters({ from, to }: VatReportFiltersProps) {
  const now = new Date();
  const months = Array.from({ length: 73 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 60 + index, 1);
    return {
      value: monthValue(date),
      label: new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date),
    };
  });
  const currentFiscalYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const fiscalYears = Array.from({ length: 8 }, (_, index) => currentFiscalYear - 5 + index);

  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs font-medium" htmlFor="vat-month">
        Calendar month
        <select id="vat-month" name="month" defaultValue="">
          <option value="">Choose a month</option>
          {months.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium" htmlFor="vat-fiscal-year">
        Fiscal year
        <select id="vat-fiscal-year" name="fiscalYear" defaultValue="">
          <option value="">Choose a fiscal year</option>
          {fiscalYears.map((year) => (
            <option key={year} value={year}>FY {year}-{String(year + 1).slice(-2)}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium" htmlFor="from">
        From<input id="from" name="from" type="date" defaultValue={from ?? ""} />
      </label>
      <label className="grid gap-1 text-xs font-medium" htmlFor="to">
        To<input id="to" name="to" type="date" defaultValue={to ?? ""} />
      </label>
      <Button type="submit" size="sm">Apply</Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/accounting/reports/vat">Clear</Link>
      </Button>
    </form>
  );
}
