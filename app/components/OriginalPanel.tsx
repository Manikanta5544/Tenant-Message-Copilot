import { statusOf } from "./ui/Dot";
import { Dot } from "./ui/Dot";
import type { InboxRow } from "../lib/types";

const LANG: Record<string, string> = { Telugu: "te", Hindi: "hi", English: "en" };
const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** Second column beside the draft on very wide screens (1700 px and up): the whole original message and the resident's other messages,
 *  so the reply can be read against what was asked. Below 1700 px the message sits above the strip as before. */
export default function OriginalPanel({ row, thread }: { row: InboxRow; thread: InboxRow[] }) {
  return (
    <aside aria-label="Original message and thread" className="original-panel">
      <h2 className="label-caps mb-1.5">Original message</h2>
      <blockquote lang={LANG[row.preferred_language] ?? "en"} className="border-l-2 border-border-strong pl-3 text-base">{row.text}</blockquote>
      <p className="tnum mt-1 text-sm text-muted">{row.resident_name}, unit {row.unit}, {when(row.created_at)}</p>
      {thread.length > 0 && (
        <>
          <h2 className="label-caps mb-1.5 mt-5">Other messages from {row.resident_name.split(" ")[0]}</h2>
          <ul className="divide-y divide-border border-y border-border text-sm">
            {thread.map((m) => (
              <li key={m.message_id} className="py-1.5"><span className="tnum flex items-center gap-2 text-muted"><Dot status={statusOf(m.run?.route)} />{when(m.created_at)}</span><span lang={LANG[m.preferred_language] ?? "en"} className="mt-0.5 line-clamp-2 block">{m.text}</span></li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
