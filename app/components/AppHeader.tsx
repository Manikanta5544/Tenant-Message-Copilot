"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStatus } from "../lib/useStatus";
import StatusCluster from "./StatusCluster";
import ThemeToggle from "./ThemeToggle";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/cx";

const NAV = [{ href: "/", label: "Inbox" }, { href: "/evals", label: "Evals" }];

export default function AppHeader() {
  const path = usePathname();
  const { s, err } = useStatus();
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-1.5 px-3 min-[420px]:gap-3 min-[420px]:px-4 sm:gap-5">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Tenant Message Copilot, home">
            <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg"><Icon name="inbox" size={17} /></span>
            <span className="hidden text-lg font-semibold tracking-tight min-[420px]:inline">Tenant Message Copilot</span>
          </Link>
          <nav aria-label="Primary" className="flex gap-0.5 sm:gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}
                className={cx("t flex min-h-11 items-center rounded-lg px-2.5 text-base font-medium sm:min-h-9 sm:px-3", path === n.href ? "bg-accent-soft text-accent" : "text-muted hover:bg-bg-subtle hover:text-text")}>{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2"><StatusCluster s={s} err={err} /><ThemeToggle /></div>
        </div>
        {s?.mock_with_key && (
          <p role="status" className="border-t border-review-line bg-review-bg px-4 py-1.5 text-center text-sm text-review">
            Mock mode is on although a model key is set: set PROVIDER_MODE=live and restart.
          </p>
        )}
      </header>
    </>
  );
}
