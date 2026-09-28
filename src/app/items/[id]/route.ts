import { NextResponse } from "next/server";
import { completeItem } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid action item ID." }, { status: 400 });
  }
  try {
    const item = completeItem(id);
    if (!item) return NextResponse.json({ error: "Action item not found." }, { status: 404 });
    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: "Could not update the action item." }, { status: 500 });
  }
}
