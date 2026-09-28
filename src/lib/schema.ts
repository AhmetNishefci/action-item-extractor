import { z } from "zod";

export const MAX_NOTE_LENGTH = 10_000;

export const noteRequestSchema = z.strictObject({
  text: z.string().min(1).max(MAX_NOTE_LENGTH).refine((text) => text.trim().length > 0),
});

export const extractionSchema = z.strictObject({
  actionItems: z.array(z.strictObject({
    description: z.string().max(500).refine((value) => value.trim().length > 0),
    owner: z.string().max(100).refine((value) => value.trim().length > 0).nullable(),
    due: z.string().max(100).refine((value) => value.trim().length > 0).nullable(),
  })).max(25),
});

export type Extraction = z.infer<typeof extractionSchema>;

export function parseExtraction(raw: string): Extraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidExtractionError();
  }
  const result = extractionSchema.safeParse(parsed);
  if (!result.success) throw new InvalidExtractionError();
  return result.data;
}

export class InvalidExtractionError extends Error {
  constructor() {
    super("The model returned an unusable extraction.");
  }
}
