"use client";
import { useState } from "react";
import type { InboxRow } from "../lib/types";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Tag } from "./ui/Tag";
import { cx } from "./ui/cx";

const LANG: Record<string, string> = { Telugu: "te", Hindi: "hi", English: "en" };

/** Who wrote, and the message itself, as a left-ruled quotation. On narrow screens it carries the back button. */
export default function MessageBlock({ row, onBack }: { row: InboxRow; onBack: () => void }) {
  const [more, setMore] = useState(false);
  const long = row.text.length > 260;
  return (
    <header>
      <Button variant="ghost" small className="-ml-2 mb-1 md:hidden" onClick={onBack}><Icon name="back" size={14} />Inbox</Button>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base"><span className="text-lg font-semibold">{row.resident_name}</span><span className="tnum text-muted">Unit {row.unit}</span>{row.preferred_language !== "English" && <Tag>{row.preferred_language}</Tag>}{row.scenario_label && <span className="text-sm text-faint">{row.scenario_label}</span>}</p>
      <blockquote lang={LANG[row.preferred_language] ?? "en"} className={cx("msg-body mt-2 max-w-[62ch] border-l-2 border-border-strong pl-3 text-base", !more && long && "line-clamp-4")}>{row.text}</blockquote>
      {long && <button type="button" onClick={() => setMore((m) => !m)} className="msg-body mt-1 min-h-11 text-sm text-muted underline underline-offset-4 hover:text-text md:min-h-6">{more ? "Show less" : "Show more"}</button>}
    </header>
  );
}
