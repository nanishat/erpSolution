"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatAmount } from "@/lib/format-amount";
import type {
  DashboardMonth,
  DashboardStatusCount,
} from "@/modules/dashboard/services/dashboard.service";

type DashboardBarChartProps = {
  data: DashboardMonth[] | DashboardStatusCount[];
  primaryLabel: string;
  secondaryLabel?: string;
};

function formatCompactAmount(value: number): string {
  const absoluteValue = Math.abs(value);
  const compactValue =
    absoluteValue >= 1_000_000
      ? `${(absoluteValue / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
      : absoluteValue >= 1_000
        ? `${(absoluteValue / 1_000).toFixed(1).replace(/\.0$/, "")}K`
        : String(absoluteValue);
  return value < 0 ? `(${compactValue})` : compactValue;
}

export function DashboardBarChart({
  data,
  primaryLabel,
  secondaryLabel,
}: DashboardBarChartProps) {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={formatCompactAmount}
            width={52}
          />
          <Tooltip
            isAnimationActive={false}
            formatter={(value, name) => [
              formatAmount(Number(value)),
              String(name) === "primary" ? primaryLabel : secondaryLabel ?? "",
            ]}
            contentStyle={{
              borderRadius: "0.5rem",
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
            }}
          />
          {secondaryLabel && (
            <Legend
              formatter={(_, entry) =>
                String(entry.dataKey) === "primary"
                  ? primaryLabel
                  : secondaryLabel
              }
            />
          )}
          <Bar
            dataKey="primary"
            name={primaryLabel}
            fill="var(--primary)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          {secondaryLabel && (
            <Bar
              dataKey="secondary"
              name={secondaryLabel}
              fill="var(--muted-foreground)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
