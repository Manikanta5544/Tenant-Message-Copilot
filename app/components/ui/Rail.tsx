"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { cx } from "./cx";

const NAV = [{ href: "/", label: "Inbox", icon: "inbox" }, { href: "/evals", label: "Evals", icon: "gauge" }, { href: "/about", label: "About", icon: "info" }] as const;

/** The one navigation. A 56 px rail on the left from md up; a slim top bar below that (same links, with labels). */
export function Rail({ footer }: { footer?: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav aria-label="Primary" className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 md:w-14 md:flex-col md:gap-1 md:border-b-0 md:border-r md:px-0 md:py-3">
      <Link href="/" aria-label="Tenant Message Copilot, home" className="t grid size-11 place-items-center rounded-md hover:bg-bg-subtle md:mb-3"><Brand /></Link>
      <ul className="flex flex-1 items-center gap-1 md:flex-col">
        {NAV.map((n) => (
          <li key={n.href}>
            <Tooltip text={n.label} className="max-md:hidden">
              <Link href={n.href} aria-current={active(n.href) ? "page" : undefined} aria-label={n.label}
                className={cx("t grid size-11 place-items-center rounded-md max-md:hidden", active(n.href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-bg-subtle hover:text-text")}><Icon name={n.icon} size={18} /></Link>
            </Tooltip>
            <Link href={n.href} aria-current={active(n.href) ? "page" : undefined}
              className={cx("t flex min-h-11 items-center rounded-md px-3 text-base font-medium md:hidden", active(n.href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-bg-subtle hover:text-text")}>{n.label}</Link>
          </li>
        ))}
      </ul>
      {footer}
    </nav>
  );
}
