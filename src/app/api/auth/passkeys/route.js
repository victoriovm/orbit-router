import { NextResponse } from "next/server";
import { getPasskeys } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const passkeys = await getPasskeys();
    return NextResponse.json({ passkeys }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[Passkeys] Failed to list credentials:", error.message);
    return NextResponse.json({ error: "Failed to load passkeys" }, { status: 500 });
  }
}
