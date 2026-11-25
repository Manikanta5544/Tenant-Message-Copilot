"use client";
import { memo, useEffect, useRef } from "react";
import type { Fact } from "@/core/types";
import { KIND_LABEL, evidenceTitle, type Link } from "../lib/evidence";
import Evidence from "./Evidence";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

/** The proof, numbered to match the footnotes in the draft. Hovering or focusing a row highlights its footnote in the draft, and the reverse.
 *  Used docked (right column) and inside the bottom sheet. */
function EvidenceRail({ facts, num, open, onToggle, link, onHot, onLine, flash }: {
  facts: Fact[]; num: Record<string, number>; open: Set<string>; onToggle: (id: string) => void; link: Link; onHot: (id: string | null) => void; onLine: (id: string | null) => void; flash: { id: string; n: number } | null;
}) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!flash) return;
    refs.current[flash.id]?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [flash]);
  if (facts.length === 0) return <p className="text-base text-muted">This reply cites no evidence.</p>;
  return (
    <ol aria-label="Evidence used" className="divide-y divide-border border-y border-border">
      {facts.map((f) => {
        const isOpen = open.has(f.id);
        return (
          <li key={f.id} id={`ev-${f.id}`} data-ev data-hot={link.ids.has(f.id)} ref={(el) => { refs.current[f.id] = el; }}
            onMouseEnter={() => onHot(f.id)} onMouseLeave={() => onHot(null)} onFocus={() => onHot(f.id)} onBlur={() => onHot(null)} className="t">
            <button type="button" onClick={() => onToggle(f.id)} aria-expanded={isOpen} aria-controls={`ev-body-${f.id}`} className="flex min-h-11 w-full items-baseline gap-2 px-1 py-2 text-left md:min-h-9">
              <span className="tnum w-7 shrink-0 text-sm font-medium text-accent">[{num[f.id]}]</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-muted">{KIND_LABEL[f.kind]} <span className="font-mono text-xs">{f.id}</span></span>
                <span className="tnum block truncate text-base font-medium">{evidenceTitle(f)}</span>
              </span>
              <Icon name="chevron" size={14} className={cx("t self-center text-faint", isOpen && "rotate-180")} />
            </button>
            {isOpen && <div id={`ev-body-${f.id}`} className={cx("pop pb-3 pr-1 [&_.tbl]:text-xs [&_.tbl_td]:px-1 [&_.tbl_th]:px-1", f.kind === "balance" ? "pl-1" : "pl-7")}><Evidence fact={f} link={link} onLine={onLine} /></div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Memoised: the rail is rendered twice (dock and sheet) and re-renders only when its own facts, open set or highlight change. */
export default memo(EvidenceRail);
