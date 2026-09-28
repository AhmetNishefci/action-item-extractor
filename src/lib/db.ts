import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Extraction } from "./schema";

export type ActionItem = {
  id: string;
  noteId: string;
  description: string;
  owner: string | null;
  due: string | null;
  completed: boolean;
  createdAt: string;
};

let database: Database.Database | undefined;

export function getDb(): Database.Database {
  if (database) return database;
  const path = process.env.DATABASE_PATH || join(process.cwd(), "data", "app.db");
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id),
      description TEXT NOT NULL,
      owner TEXT,
      due TEXT,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS action_items_created_at_idx ON action_items(created_at DESC);
  `);
  database = db;
  return db;
}

type ItemRow = Omit<ActionItem, "completed" | "noteId" | "createdAt"> & {
  note_id: string;
  completed: number;
  created_at: string;
};

function fromRow(row: ItemRow): ActionItem {
  return {
    id: row.id, noteId: row.note_id, description: row.description,
    owner: row.owner, due: row.due, completed: row.completed === 1, createdAt: row.created_at,
  };
}

export function listItems(db = getDb()): ActionItem[] {
  const rows = db.prepare(`SELECT action_items.* FROM action_items
    JOIN notes ON notes.id = action_items.note_id
    ORDER BY notes.rowid DESC, action_items.rowid ASC`).all() as ItemRow[];
  return rows.map(fromRow);
}

export function saveExtraction(text: string, extraction: Extraction, db = getDb()): ActionItem[] {
  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const insertNote = db.prepare("INSERT INTO notes (id, raw_text, created_at) VALUES (?, ?, ?)");
  const insertItem = db.prepare(`INSERT INTO action_items
    (id, note_id, description, owner, due, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  return db.transaction(() => {
    insertNote.run(noteId, text, now);
    const items = extraction.actionItems.map((item) => {
      const id = crypto.randomUUID();
      insertItem.run(id, noteId, item.description, item.owner, item.due, now);
      return { id, noteId, ...item, completed: false, createdAt: now };
    });
    return items;
  })();
}

export function completeItem(id: string, db = getDb()): ActionItem | null {
  db.prepare("UPDATE action_items SET completed = 1 WHERE id = ?").run(id);
  const row = db.prepare("SELECT * FROM action_items WHERE id = ?").get(id) as ItemRow | undefined;
  return row ? fromRow(row) : null;
}
