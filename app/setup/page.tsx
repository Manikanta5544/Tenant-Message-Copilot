import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { runChecks, type Check } from "@/db/diagnostics";
import { Dot, type Status } from "../components/ui/Dot";
import FixBlock from "./FixBlock";
import Refresh from "./Refresh";
import { isDev } from "@/core/dev";
import { rawEnv } from "@/core/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Setup" };
const DOT: Record<Check["status"], { s: Status; w: string }> = { ok: { s: "ready", w: "OK" }, warn: { s: "review", w: "Check" }, fail: { s: "escalate", w: "Fix" }, skipped: { s: "none", w: "Skipped" } };

/** Development-only live checklist: the same checks as `npm run dev` prints at startup. Read-only; shows "set / not set" and host:port, never a secret.
 *  In production this route does not exist. */
export default async function SetupPage() {
  if (!isDev()) notFound();
  const checks = await runChecks(rawEnv(), { live: true });
  const bad = checks.filter((c) => c.status === "fail").length;
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-4 py-8 outline-none md:px-6">
      <h1 className="text-2xl">Setup checklist</h1>
      <p className="mt-2 max-w-[62ch] text-muted">Development only. Fix the first failing row, press Check again, and work down. Nothing here shows a secret.</p>
      <p role="status" className="mt-3 text-base"><Dot status={bad ? "escalate" : "ready"} label={bad ? `${bad} thing${bad === 1 ? "" : "s"} to fix` : "Everything required is in place"} className="font-medium" /></p>
      <ol className="mt-4 divide-y divide-border border-y border-border" aria-label="Checks">
        {checks.map((c) => (
          <li key={c.id} className="py-3">
            <p className="flex flex-wrap items-baseline gap-x-3"><Dot status={DOT[c.status].s} label={DOT[c.status].w} className="w-20 shrink-0 text-sm" /><span className="font-medium">{c.label}</span></p>
            <p className="mt-0.5 pl-0 text-base text-muted sm:pl-[5.75rem]">{c.detail}</p>
            {c.fix && c.status !== "ok" && <div className="sm:pl-[5.75rem]"><FixBlock fix={c.fix} /></div>}
          </li>
        ))}
      </ol>
      <div className="mt-5"><Refresh /></div>
    </main>
  );
}
