"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type VatReportFiltersProps = {
  defaultValues: {
    from?: string;
    to?: string;
  };
};

export function VatReportFilters({ defaultValues }: VatReportFiltersProps) {
  const [from, setFrom] = useState(defaultValues.from ?? "");
  const [to, setTo] = useState(defaultValues.to ?? "");
  const currentDate = new Date();
  const currentCalendarMonth = Date.UTC(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  );
  const months = Array.from({ length: 73 }, (_, index) => {
    const date = new Date(currentCalendarMonth);
    date.setUTCMonth(date.getUTCMonth() - 60 + index);
    return {
      value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
    };
  });
  const currentFiscalYear =
    currentDate.getMonth() >= 6 ? currentDate.getFullYear() : currentDate.getFullYear() - 1;
  const fiscalYears = Array.from({ length: 8 }, (_, index) => currentFiscalYear - 5 + index);

  const fillMonth = (value: string) => {
    if (!value) return;
    const [yearText, monthText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    setFrom(`${yearText}-${monthText}-01`);
    setTo(`${yearText}-${monthText}-${String(lastDay).padStart(2, "0")}`);
  };

  const fillFiscalYear = (startYear: number) => {
    setFrom(`${startYear}-07-01`);
    setTo(`${startYear + 1}-06-30`);
  };

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4"
    >
      <div>
        <label className="text-sm font-medium" htmlFor="vat-calendar-month">
          Calendar month
        </label>
        <select
          id="vat-calendar-month"
          defaultValue=""
          onChange={(event) => {
            fillMonth(event.target.value);
            event.currentTarget.value = "";
          }}
          className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Fill dates from a month</option>
          {months.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="vat-fiscal-year">
          Fiscal year
        </label>
        <select
          id="vat-fiscal-year"
          defaultValue=""
          onChange={(event) => {
            if (event.currentTarget.value) fillFiscalYear(Number(event.currentTarget.value));
            event.currentTarget.value = "";
          }}
          className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Fill dates from a fiscal year</option>
          {fiscalYears.map((year) => (
            <option key={year} value={year}>
              FY {year}-{String(year + 1).slice(-2)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="from">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="to">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <Button type="submit">Apply</Button>
    </form>
  );
}
