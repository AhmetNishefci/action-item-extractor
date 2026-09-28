import { NextResponse } from "next/server";
import { extractAndSave, ExtractionFailure } from "@/lib/extraction-service";
import { GroqExtractor } from "@/lib/extractor";
import { noteRequestSchema } from "@/lib/schema";
import { saveExtraction } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a text field.", requestId }, { status: 400 });
  }
  const parsed = noteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter meeting notes (up to 10,000 characters).", requestId }, { status: 400 });
  }
  try {
    const items = await extractAndSave(parsed.data.text, requestId, new GroqExtractor(), saveExtraction);
    return NextResponse.json({ items, requestId }, { status: 201 });
  } catch (error) {
    if (error instanceof ExtractionFailure) {
      return NextResponse.json({ error: error.userMessage, requestId }, { status: error.status });
    }
    return NextResponse.json({ error: "Something went wrong. Please try again.", requestId }, { status: 500 });
  }
}
