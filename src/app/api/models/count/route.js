import { NextResponse } from "next/server";
import { getModelsCount } from "@/lib/modelsCount";

export const dynamic = "force-dynamic";

// GET /api/models/count - how many models the gateway exposes, without the
// cost of building the whole catalog (see lib/modelsCount).
export async function GET() {
  try {
    const count = await getModelsCount();
    return NextResponse.json({ count });
  } catch (error) {
    console.log("Error counting models:", error);
    return NextResponse.json({ error: "Failed to count models" }, { status: 500 });
  }
}