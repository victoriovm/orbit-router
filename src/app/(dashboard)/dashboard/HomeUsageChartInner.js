"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

// Chart body for the home page: data arrives with the overview payload, so
// this component only renders (no fetch). Loaded dynamically so recharts does
// not weigh down the home page's first paint.
export default function HomeUsageChartInner({ data = [] }) {
  const [viewMode, setViewMode] = useState("tokens");

  return (
    <>
      <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
        <button
          onClick={() => setViewMode("tokens")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Tokens
        </button>
        <button
          onClick={() => setViewMode("cost")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "cost" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Cost
        </button>
      </div>

      <ResponsiveContainer width="100%" height="100%" className="min-h-48 flex-1">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="homeGradTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="homeGradCost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
            width={50}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value, name) =>
              name === "tokens" ? [fmtTokens(value), "Tokens"] : [fmtCost(value), "Cost"]
            }
          />
          {viewMode === "tokens" ? (
            <Area
              type="monotone"
              dataKey="tokens"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#homeGradTokens)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : (
            <Area
              type="monotone"
              dataKey="cost"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#homeGradCost)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

HomeUsageChartInner.propTypes = {
  data: PropTypes.array,
};
