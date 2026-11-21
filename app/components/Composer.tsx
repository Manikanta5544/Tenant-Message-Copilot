"use client";
import { useId, useState } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export type Resident = { id: string; name: string; unit: string; preferred_language: string };

export default function Composer({ residents, onCreated }: { residents: Resident[]; onCreated: (messageId: string) => void }) {
  const [res, setRes] = useState(residents[0]?.id ?? ""); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resident_id: res, text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setText(""); onCreated(j.message_id);
    } catch (e) { setErr(`The message could not be added: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const field = "mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base placeholder:text-faint";
  return (
    <Card as="section" aria-label="Custom message" className="p-4">
      <h2 className="text-lg">Write a message as a resident</h2>
      <label htmlFor={`${id}-who`} className="mt-3 block text-sm font-medium text-muted">Resident (synthetic)</label>
      <select id={`${id}-who`} value={res} onChange={(e) => setRes(e.target.value)} className={field}>
        {residents.map((r) => <option key={r.id} value={r.id}>{r.name}, unit {r.unit} ({r.preferred_language})</option>)}
      </select>
      <label htmlFor={`${id}-msg`} className="mt-3 block text-sm font-medium text-muted">Message</label>
      <textarea id={`${id}-msg`} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={3} className={field} placeholder="For example: when is my rent due this month?" />
      <div className="mt-2 flex items-center gap-3">
        <span className="num text-sm text-muted" aria-live="off">{text.length}/1000</span>
        <Button variant="primary" className="ml-auto" onClick={submit} disabled={busy || !text.trim()} title={!text.trim() ? "Type a message first" : undefined}>{busy ? "Adding…" : "Add to inbox"}</Button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-escalate">{err}</p>}
    </Card>
  );
}
