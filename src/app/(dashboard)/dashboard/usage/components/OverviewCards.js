"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fmt = (number) => compactNumberFormatter.format(number || 0);
const fmtCost = (number) => {
  const value = number || 0;
  return Math.abs(value) >= 1000 ? `$${fmt(value)}` : `$${value.toFixed(2)}`;
};

function UsageMetricCard({ label, value, icon, tone = "text-text-main", detail }) {
  return (
    <Card className="flex min-w-0 items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        <p className={`mt-1 truncate text-2xl font-bold ${tone}`}>{value}</p>
        {detail ? <p className="mt-1 text-[10px] text-text-muted">{detail}</p> : null}
      </div>
      <span className="material-symbols-outlined rounded-[10px] bg-bg p-2 text-[20px] text-text-muted">
        {icon}
      </span>
    </Card>
  );
}

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <UsageMetricCard label="Total Requests" value={fmt(stats.totalRequests)} icon="send" />
      <UsageMetricCard label="Total Input Tokens" value={fmt(stats.totalPromptTokens)} icon="input" tone="text-primary" />
      <UsageMetricCard label="Cached Tokens" value={fmt(stats.totalCachedTokens)} icon="cached" tone="text-info" />
      <UsageMetricCard label="Output Tokens" value={fmt(stats.totalCompletionTokens)} icon="output" tone="text-success" />
      <UsageMetricCard
        label="Est. Cost"
        value={`~${fmtCost(stats.totalCost)}`}
        icon="payments"
        tone="text-warning"
        detail="Estimated, not actual billing"
      />
    </div>
  );
}

UsageMetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  tone: PropTypes.string,
  detail: PropTypes.string,
};

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
