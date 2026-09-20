import { NextResponse } from "next/server";
import { getCatalogPullState, pullModelCatalog } from "@/lib/modelCatalog/pull.js";

export const dynamic = "force-dynamic";

// GET /api/models/catalog-pull - When the models.dev catalog was last pulled
export async function GET() {
  return NextResponse.json(getCatalogPullState());
}

// POST /api/models/catalog-pull - Pull the catalog now instead of waiting for the timer
export async function POST() {
  const result = await pullModelCatalog();
  if (!result) {
    return NextResponse.json(
      { error: getCatalogPullState().lastError || "pull in progress" },
      { status: 503 },
    );
  }
  return NextResponse.json({ success: true, result, state: getCatalogPullState() });
}