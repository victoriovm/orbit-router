"use client";

import { Suspense, useState } from "react";
import { UsageStats, CardSkeleton, SegmentedControl } from "@/shared/components";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const [period, setPeriod] = useState("today");

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <span className="material-symbols-outlined usage-panel-header-icon">monitoring</span>
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-text-main">Usage overview</h2>
            <p className="truncate text-xs text-text-muted">Requests, tokens, and estimated costs</p>
          </div>
        </div>
        <SegmentedControl
          options={PERIODS}
          value={period}
          onChange={setPeriod}
          size="sm"
          className="w-full sm:w-auto"
        />
      </div>

      <Suspense fallback={<CardSkeleton />}>
        <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
      </Suspense>
    </div>
  );
}
