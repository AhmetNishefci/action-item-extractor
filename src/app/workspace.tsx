"use client";

import { useState, type FormEvent } from "react";
import type { ActionItem } from "@/lib/db";
import { MAX_NOTE_LENGTH } from "@/lib/schema";

type Props = { initialItems: ActionItem[] };

export function Workspace({ initialItems }: Props) {
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const openCount = items.filter((item) => !item.completed).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!notes.trim() || notes.length > MAX_NOTE_LENGTH || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/notes/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: notes }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = (result as { error?: unknown }).error;
        throw new Error(typeof message === "string" ? message : "Extraction failed. Please try again.");
      }
      const newItems = (result as { items: ActionItem[] }).items;
      setItems((current) => [...newItems, ...current]);
      setNotes("");
      setNotice(newItems.length ? `${newItems.length} action ${newItems.length === 1 ? "item" : "items"} extracted and saved.` : "No action items found. The note was saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extraction failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function markDone(id: string) {
    setUpdatingId(id);
    setError("");
    try {
      const response = await fetch(`/items/${id}`, { method: "PATCH" });
      if (!response.ok) throw new Error("Could not mark the item done. Please try again.");
      setItems((current) => current.map((item) => item.id === id ? { ...item, completed: true } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the item.");
    } finally {
      setUpdatingId(null);
    }
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">✳</span><span>Action Item Extractor</span></div>
      <span className="topbar-tag">INTERNAL WORKSPACE</span>
    </header>
    <div className="content">
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">MEETING NOTES, MADE USEFUL</p>
        <h1 id="page-title">Keep the follow-through clear.</h1>
        <p>Paste rough notes. Get a focused list of commitments you can track.</p>
      </section>
      <div className="grid">
        <section className="card composer" aria-labelledby="notes-heading">
          <div className="section-heading"><span className="step">01</span><div><h2 id="notes-heading">Meeting notes</h2><p>Raw notes are fine. No formatting needed.</p></div></div>
          <form onSubmit={submit}>
            <label htmlFor="notes">Paste your notes</label>
            <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={MAX_NOTE_LENGTH} disabled={busy} placeholder={"e.g. Ana will send the revised launch plan by Friday. We also talked about the signup flow..."} rows={14} />
            <div className="textarea-footer"><span>Only actionable follow-ups will become items.</span><span>{notes.length.toLocaleString()} / {MAX_NOTE_LENGTH.toLocaleString()}</span></div>
            <button className="primary-button" type="submit" disabled={busy || !notes.trim()}>{busy ? "Extracting…" : "Extract action items"}<span aria-hidden="true">→</span></button>
            <p className="helper">Your notes stay here if extraction fails.</p>
          </form>
        </section>
        <section className="card results" aria-labelledby="items-heading">
          <div className="section-heading results-heading"><span className="step">02</span><div><h2 id="items-heading">Action items</h2><p>{items.length ? `${openCount} open · ${items.length} total` : "Your extracted work will appear here."}</p></div></div>
          {error && <div className="message error" role="alert">{error}<span>Your notes are still here.</span></div>}
          {notice && <div className="message success" role="status">{notice}</div>}
          {items.length ? <ul className="item-list">{items.map((item) => <li className={`item ${item.completed ? "is-done" : ""}`} key={item.id}>
            <button className="check" type="button" aria-label={`Mark ${item.description} done`} disabled={item.completed || updatingId === item.id} onClick={() => markDone(item.id)}>{item.completed && <span aria-hidden="true">✓</span>}</button>
            <div className="item-body"><p>{item.description}</p><div className="item-meta">{item.owner && <span>Owner: {item.owner}</span>}{item.due && <span>Due: {item.due}</span>}{item.completed && <span>Done</span>}</div></div>
          </li>)}</ul> : <div className="empty-state"><div className="empty-icon" aria-hidden="true">✓</div><h3>A clearer next step starts here.</h3><p>Add meeting notes and extracted commitments will show up in this list.</p></div>}
        </section>
      </div>
      <footer>Action items are kept as extracted. Mark them done as work moves forward.</footer>
    </div>
  </main>;
}
