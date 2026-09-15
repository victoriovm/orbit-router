"use client";

import dynamic from "next/dynamic";
import Card from "@/shared/components/Card";
import { translate } from "@/i18n/runtime";

// Recharts stays out of the home page's first-paint bundle: it only loads
// once the overview payload (with chart data) has arrived.
const HomeUsageChartInner = dynamic(() => import("./HomeUsageChartInner"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-48 flex-1 items-center justify-center text-sm text-text-muted">
      {translate("Loading...")}
    </div>
  ),
});

export default function HomeUsageChart({ data, loading }) {
  const hasData = Array.isArray(data) && data.some((d) => d.tokens > 0 || d.cost > 0);

  return (
    <Card className="flex h-full min-w-0 flex-col gap-3 p-3 sm:p-4">
      {loading || !data ? (
        <div className="flex min-h-48 flex-1 items-center justify-center text-sm text-text-muted">
          {translate("Loading...")}
        </div>
      ) : !hasData ? (
        <div className="flex min-h-48 flex-1 items-center justify-center text-sm text-text-muted">
          {translate("No data for this period")}
        </div>
      ) : (
        <HomeUsageChartInner data={data} />
      )}
    </Card>
  );
}
