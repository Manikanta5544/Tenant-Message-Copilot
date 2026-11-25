import { memo } from "react";
import { INTENT_LABEL, agoShort } from "../lib/format";
import type { InboxRow as Row } from "../lib/types";
import { Dot, STATUS_WORD, statusOf } from "./ui/Dot";
import { Tag } from "./ui/Tag";
import { cx } from "./ui/cx";

/** One dense row: status dot, name and unit, relative time, one-line preview, at most one secondary tag (intent).
 *  Language is shown only when it is not English. Unread is bold. Roving tabindex: only the active row is in the tab order. */
function InboxRow({ m, selected, unread, tabbable, onSelect }: { m: Row; selected: boolean; unread: boolean; tabbable: boolean; onSelect: (r: Row) => void }) {
  const lang = m.run?.language ?? m.preferred_language;
  const tag = m.run?.intent ? INTENT_LABEL[m.run.intent] : null;
  return (
    <button type="button" data-inbox-row data-id={m.message_id} tabIndex={tabbable ? 0 : -1} onClick={() => onSelect(m)} aria-current={selected ? "true" : undefined}
      className={cx("t group relative grid min-h-11 w-full grid-cols-[14px_1fr] gap-x-2.5 border-b border-border px-3 py-2.5 text-left hover:bg-bg-subtle focus-visible:bg-bg-subtle", selected && "bg-row-selected hover:bg-row-selected")}>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      <span className="pt-[5px]"><Dot status={statusOf(m.run?.route)} /></span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={cx("truncate text-base", unread ? "font-semibold text-text" : "text-text")}>{m.resident_name}</span>
          <span className="tnum shrink-0 text-sm text-muted">{m.unit}</span>
          <time dateTime={m.created_at} className="tnum ml-auto shrink-0 text-sm text-faint">{agoShort(m.created_at)}</time>
        </span>
        <span className={cx("mt-0.5 block text-sm", selected ? "line-clamp-2" : "line-clamp-1 group-hover:line-clamp-2 group-focus-visible:line-clamp-2", unread ? "text-text" : "text-muted")}>{m.text}</span>
        {(tag || (lang && lang !== "English") || m.scenario_label || selected) && (
          <span className="mt-1 flex items-center gap-1.5">
            <span className={cx("text-xs font-medium text-text", selected ? "" : "hidden group-hover:inline group-focus-visible:inline")}>{STATUS_WORD[statusOf(m.run?.route)]}</span>
            {tag && <Tag>{tag}</Tag>}
            {lang && lang !== "English" && <span className="text-xs text-muted">{lang}</span>}
            {m.scenario_label && <span className="ml-auto text-xs text-faint">{m.scenario_label}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/** Memoised: selecting a row or typing in search re-renders the list, but only the rows whose own props changed. */
export default memo(InboxRow);
