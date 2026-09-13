import { NextResponse } from "next/server";
import { getDashboardOverview } from "@/lib/db/repos/overviewRepo.js";

export const dynamic = "force-dynamic";

// GET /api/dashboard/overview — single round-trip for the home page.
// Returns provider health (slim), today's counters, recent requests, the
// local-tables models estimate, and the 7-day chart. All queries are bounded
// (indexed aggregates + LIMIT), so first paint stays fast even with a large
// usage history and many connections — no cache warm-up required.
export async function GET() {
  try {
    const overview = await getDashboardOverview();
    return NextResponse.json(overview);
  } catch (error) {
    console.error("[API] Failed to get dashboard overview:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard overview" }, { status: 500 });
  }
}
