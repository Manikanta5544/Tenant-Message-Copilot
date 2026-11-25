"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { Tooltip } from "./Tooltip";
import { cx } from "./cx";

const NAV = [{ href: "/", label: "Inbox", icon: "inbox" }, { href: "/evals", label: "Evals", icon: "gauge" }, { href: "/about", label: "About", icon: "info" }] as const;
const EXTRA = [{ href: "/system", label: "System" }] as const;

/** The one navigation. A 56 px rail on the left from 768 px up (icons, the active route marked by a 2 px accent bar);
 *  a 48 px top bar below that: monogram, the section title, and a menu button that opens the same links in a sheet. */
export function Rail({ footer }: { footer?: React.ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const title = [...NAV, ...EXTRA].find((n) => active(n.href))?.label ?? "Tenant Message Copilot";
  return (
    <nav aria-label="Primary" className="rail">
      <Link href="/" aria-label="Tenant Message Copilot, home" className="t grid size-11 place-items-center rounded-md hover:bg-bg-subtle md:mb-3"><Brand /></Link>
      <span className="nav-title text-base" data-testid="section-title">{title}</span>
      <button type="button" className="nav-menu t grid size-11 place-items-center rounded-md text-muted hover:bg-bg-subtle hover:text-text" aria-haspopup="dialog" aria-expanded={menu} aria-label="Open menu" onClick={() => setMenu(true)}><Icon name="menu" size={18} /></button>
      <ul className="rail-list">
        {NAV.map((n) => (
          <li key={n.href}>
            <Tooltip text={n.label} className="nav-icon">
              <Link href={n.href} aria-current={active(n.href) ? "page" : undefined} aria-label={n.label}
                className={cx("t grid size-11 place-items-center rounded-md", active(n.href) ? "nav-active" : "text-muted hover:bg-bg-subtle hover:text-text")}><Icon name={n.icon} size={18} /></Link>
            </Tooltip>
          </li>
        ))}
      </ul>
      <div className="rail-foot">
        <Tooltip text="Keyboard shortcuts (?)" className="grid">
          <button type="button" aria-label="Keyboard shortcuts" onClick={() => window.dispatchEvent(new Event("tmc:help"))} className="t grid size-11 place-items-center rounded-md text-muted hover:bg-bg-subtle hover:text-text"><Icon name="help" size={18} /></button>
        </Tooltip>
      </div>
      {footer}
      <Sheet open={menu} onClose={() => setMenu(false)} title="Menu">
        <ul className="space-y-1">
          {[...NAV, ...EXTRA].map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={active(n.href) ? "page" : undefined} onClick={() => setMenu(false)}
                className={cx("t relative flex min-h-11 items-center rounded-md px-3 text-base font-medium", active(n.href) ? "text-accent" : "text-muted hover:bg-bg-subtle hover:text-text")}>
                {active(n.href) && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 bg-accent" />}{n.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </nav>
  );
}
