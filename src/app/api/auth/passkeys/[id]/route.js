import { NextResponse } from "next/server";
import { deletePasskey } from "@/lib/localDb";

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deletePasskey(id);
    if (!deleted) return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn("[Passkeys] Failed to delete credential:", error.message);
    return NextResponse.json({ error: "Failed to delete passkey" }, { status: 500 });
  }
}
