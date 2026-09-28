import type { ActionItemExtractor } from "./extractor";
import { ProviderTimeoutError } from "./extractor";
import { InvalidExtractionError, parseExtraction } from "./schema";
import type { ActionItem } from "./db";

export type Save = (text: string, extraction: ReturnType<typeof parseExtraction>) => ActionItem[];

export class ExtractionFailure extends Error {
  constructor(
    public readonly code: "timeout" | "provider" | "invalid_output" | "persistence",
    public readonly status: number,
    public readonly userMessage: string,
  ) { super(userMessage); }
}

export async function extractAndSave(
  text: string,
  requestId: string,
  extractor: ActionItemExtractor,
  save: Save,
  timeoutMs = 1500,
): Promise<ActionItem[]> {
  const started = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, timeoutMs);
  });
  let rawResponse: string | null = null;
  let stage = "provider";
  let failure: string | null = null;
  try {
    rawResponse = await Promise.race([extractor.extract(text, controller.signal), timeout]);
    stage = "validation";
    const extraction = parseExtraction(rawResponse);
    stage = "persistence";
    return save(text, extraction);
  } catch (error) {
    if (controller.signal.aborted || error instanceof ProviderTimeoutError) {
      failure = "timeout";
      throw new ExtractionFailure("timeout", 504, "Extraction took too long. Please try again.");
    }
    if (error instanceof InvalidExtractionError) {
      failure = "invalid_output";
      throw new ExtractionFailure("invalid_output", 502, "The model returned an unusable result. Nothing was saved.");
    }
    if (stage === "provider") {
      failure = "provider";
      throw new ExtractionFailure("provider", 502, "The extraction service is unavailable. Please try again.");
    }
    failure = "persistence";
    throw new ExtractionFailure("persistence", 500, "Could not save the extraction. Nothing was saved.");
  } finally {
    if (timer) clearTimeout(timer);
    console.info(JSON.stringify({
      event: "extraction", requestId, noteText: text, rawResponse,
      latencyMs: Math.round(performance.now() - started),
      success: failure === null, failureStage: failure ? stage : null, failure,
    }));
  }
}
