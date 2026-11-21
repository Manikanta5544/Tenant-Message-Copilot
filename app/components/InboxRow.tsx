import { INTENT_LABEL, ago } from "../lib/format";
import type { InboxRow as Row } from "../lib/types";
import { Avatar } from "./ui/Avatar";
import { Chip, StatusPill } from "./ui/Chip";
import { cx } from "./ui/cx";

export default function InboxRow({ m, selected, onSelect }: { m: Row; selected: boolean; onSelect: (r: Row) => void }) {
  return (
    <button type="button" data-inbox-row onClick={() => onSelect(m)} aria-current={selected ? "true" : undefined}
      className={cx("t relative flex min-h-11 w-full gap-3 px-3 py-3 text-left hover:bg-bg-subtle focus-visible:bg-bg-subtle", selected && "bg-accent-soft hover:bg-accent-soft")}>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />}
      <Avatar name={m.resident_name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-base font-semibold">{m.resident_name}</span>
          <span className="num shrink-0 text-sm text-muted">Unit {m.unit}</span>
          <time dateTime={m.created_at} className="ml-auto shrink-0 text-sm text-faint">{ago(m.created_at)}</time>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{m.text}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.scenario_label && <Chip tone="accent">{m.scenario_label}</Chip>}
          <Chip>{m.run?.language ?? m.preferred_language}</Chip>
          {m.run?.intent && <Chip>{INTENT_LABEL[m.run.intent]}</Chip>}
          {m.run?.urgency === "urgent" && <Chip tone="escalate" icon="alert">Urgent</Chip>}
          <span className="ml-auto"><StatusPill route={m.run?.route ?? null} /></span>
        </span>
      </span>
    </button>
  );
}
