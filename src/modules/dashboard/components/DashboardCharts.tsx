"use client";

import { useSyncExternalStore } from "react";
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
  DashboardValue,
} from "@/modules/dashboard/services/dashboard.service";

type DashboardBarChartProps = {
  data: DashboardMonth[];
  primaryLabel: string;
  secondaryLabel: string;
};

type DashboardHorizontalBarChartProps = {
  data: DashboardValue[];
};

function subscribeToReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getReducedMotionPreference() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionPreference,
    () => true
  );
}

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

const tooltipStyle = {
  borderRadius: "0.5rem",
  borderColor: "var(--border)",
  backgroundColor: "var(--background)",
  color: "var(--foreground)",
};

export function DashboardBarChart({
  data,
  primaryLabel,
  secondaryLabel,
}: DashboardBarChartProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="h-[260px] w-full">
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
              String(name) === "primary" ? primaryLabel : secondaryLabel,
            ]}
            contentStyle={tooltipStyle}
          />
          <Legend
            formatter={(_, entry) =>
              String(entry.dataKey) === "primary"
                ? primaryLabel
                : secondaryLabel
            }
          />
          <Bar
            dataKey="primary"
            name={primaryLabel}
            fill="var(--chart-1)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={!prefersReducedMotion}
            animationDuration={700}
          />
          <Bar
            dataKey="secondary"
            name={secondaryLabel}
            fill="#94a3b8"
            radius={[3, 3, 0, 0]}
            isAnimationActive={!prefersReducedMotion}
            animationDuration={700}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardHorizontalBarChart({
  data,
}: DashboardHorizontalBarChartProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 20, left: 4, bottom: 0 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={formatCompactAmount}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            width={132}
          />
          <Tooltip
            isAnimationActive={false}
            formatter={(value) => [formatAmount(Number(value)), "Amount"]}
            contentStyle={tooltipStyle}
          />
          <Bar
            dataKey="primary"
            name="Amount"
            fill="var(--chart-1)"
            radius={[0, 3, 3, 0]}
            isAnimationActive={!prefersReducedMotion}
            animationDuration={700}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
