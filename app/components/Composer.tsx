"use client";
import { useId, useState } from "react";
import { Button } from "./ui/Button";

export type Resident = { id: string; name: string; unit: string; preferred_language: string };

/** Adds a message as a (synthetic) resident. Collapsed by default so the list keeps the space. */
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
  const field = "mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-base placeholder:text-faint";
  return (
    <details className="group shrink-0 border-t border-border">
      <summary className="t flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-base font-medium hover:bg-bg-subtle md:min-h-9">Write a message as a resident<span aria-hidden className="text-muted group-open:hidden">+</span><span aria-hidden className="hidden text-muted group-open:inline">−</span></summary>
      <section aria-label="Custom message" className="px-3 pb-3">
        <label htmlFor={`${id}-who`} className="mt-1 block text-sm text-muted">Resident (synthetic)</label>
        <select id={`${id}-who`} value={res} onChange={(e) => setRes(e.target.value)} className={field + " min-h-11 md:min-h-8"}>
          {residents.map((r) => <option key={r.id} value={r.id}>{r.name}, unit {r.unit} ({r.preferred_language})</option>)}
        </select>
        <label htmlFor={`${id}-msg`} className="mt-2 block text-sm text-muted">Message</label>
        <textarea id={`${id}-msg`} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={3} className={field} placeholder="For example: when is my rent due this month?" />
        <div className="mt-2 flex items-center gap-3">
          <span className="tnum text-sm text-muted" aria-live="off">{text.length}/1000</span>
          <Button variant="primary" className="ml-auto" onClick={submit} disabled={busy || !text.trim()} title={!text.trim() ? "Type a message first" : undefined}>{busy ? "Adding…" : "Add to inbox"}</Button>
        </div>
        {err && <p role="alert" className="mt-2 text-sm text-escalate">{err}</p>}
      </section>
    </details>
  );
}
