import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractAndSave, type Save } from "../src/lib/extraction-service";
import { ProviderUnavailableError, type ActionItemExtractor } from "../src/lib/extractor";
import { getDb, completeItem, listItems, saveExtraction } from "../src/lib/db";
import { noteRequestSchema, parseExtraction } from "../src/lib/schema";
import { POST } from "../src/app/notes/extract/route";
import { PATCH } from "../src/app/items/[id]/route";

const valid = JSON.stringify({ actionItems: [
  { description: "Ana to send the revised plan", owner: "Ana", due: "Friday" },
  { description: "Check with product about SSO", owner: null, due: null },
] });
const provider = (result: string | Error): ActionItemExtractor => ({
  extract: async () => { if (result instanceof Error) throw result; return result; },
});

describe("extraction boundary", () => {
  it("accepts valid structured output and passes it to persistence", async () => {
    const save = vi.fn<Save>(() => []);
    await extractAndSave("Ana will send a plan", "test-1", provider(valid), save);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![1].actionItems).toHaveLength(2);
  });

  it("logs the full note and raw model response for audit", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await extractAndSave("Full private meeting note", "audit-id", provider(valid), () => []);
      expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
        requestId: "audit-id", noteText: "Full private meeting note", rawResponse: valid,
        success: true,
      });
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ["malformed JSON", "not JSON"],
    ["missing required field", JSON.stringify({ actionItems: [{ description: "Do work", owner: null }] })],
    ["invalid type", JSON.stringify({ actionItems: [{ description: 42, owner: null, due: null }] })],
    ["blank description", JSON.stringify({ actionItems: [{ description: "  ", owner: null, due: null }] })],
    ["unexpected field", JSON.stringify({ actionItems: [{ description: "Do work", owner: null, due: null, priority: "high" }] })],
  ])("rejects %s without saving", async (_name, output) => {
    const save = vi.fn(() => []);
    await expect(extractAndSave("notes", "test-invalid", provider(output), save))
      .rejects.toMatchObject({ code: "invalid_output", status: 502 });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects provider failure without saving", async () => {
    const save = vi.fn(() => []);
    await expect(extractAndSave("notes", "test-provider", provider(new ProviderUnavailableError("network")), save))
      .rejects.toMatchObject({ code: "provider", status: 502 });
    expect(save).not.toHaveBeenCalled();
  });

  it("times out even when a provider ignores the abort signal", async () => {
    const save = vi.fn(() => []);
    const hanging: ActionItemExtractor = { extract: () => new Promise<string>(() => {}) };
    await expect(extractAndSave("notes", "test-timeout", hanging, save, 10))
      .rejects.toMatchObject({ code: "timeout", status: 504 });
    expect(save).not.toHaveBeenCalled();
  });

  it("validates empty, whitespace, and oversized notes", () => {
    for (const text of ["", " \n ", "a".repeat(10_001)]) {
      expect(noteRequestSchema.safeParse({ text }).success).toBe(false);
    }
    expect(noteRequestSchema.safeParse({ text: "Review launch plan" }).success).toBe(true);
  });

  it("accepts no-action results without inventing tasks", () => {
    expect(parseExtraction('{"actionItems":[]}').actionItems).toEqual([]);
  });
});

describe("SQLite persistence", () => {
  let directory: string;
  let db: Database.Database;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "action-extractor-test-"));
    process.env.DATABASE_PATH = join(directory, "test.db");
    db = getDb();
  });
  afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it("saves the note and all validated items, then persists completion", () => {
    const items = saveExtraction("full raw note", parseExtraction(valid), db);
    expect(items).toHaveLength(2);
    expect((db.prepare("SELECT raw_text FROM notes WHERE id = ?").get(items[0]!.noteId) as { raw_text: string }).raw_text).toBe("full raw note");
    expect(listItems(db)).toHaveLength(2);
    expect(listItems(db).map((item) => item.description)).toEqual(items.map((item) => item.description));
    expect(completeItem(items[0]!.id, db)?.completed).toBe(true);
    expect(listItems(db).find((item) => item.id === items[0]!.id)?.completed).toBe(true);
    expect(completeItem(items[0]!.id, db)?.description).toBe(items[0]!.description);
  });

  it("rolls back the note and earlier items if an insert fails", () => {
    const beforeNotes = (db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
    const beforeItems = listItems(db).length;
    db.exec(`CREATE TRIGGER reject_second_item BEFORE INSERT ON action_items
      WHEN NEW.description = 'Check with product about SSO'
      BEGIN SELECT RAISE(ABORT, 'test insert failure'); END;`);
    expect(() => saveExtraction("must roll back", parseExtraction(valid), db)).toThrow();
    db.exec("DROP TRIGGER reject_second_item");
    expect((db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n).toBe(beforeNotes);
    expect(listItems(db)).toHaveLength(beforeItems);
  });

  it("serves extraction and completion through the HTTP handlers", async () => {
    process.env.GROQ_API_KEY = "test-only-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: valid } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await POST(new Request("http://localhost/notes/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Ana will send the plan." }),
      }));
      expect(response.status).toBe(201);
      const body = await response.json() as { items: { id: string; completed: boolean }[] };
      expect(body.items).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledOnce();
      const completion = await PATCH(new Request(`http://localhost/items/${body.items[0]!.id}`, { method: "PATCH" }), {
        params: Promise.resolve({ id: body.items[0]!.id }),
      });
      expect(completion.status).toBe(200);
      expect((await completion.json() as { item: { completed: boolean } }).item.completed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GROQ_API_KEY;
    }
  });
});
