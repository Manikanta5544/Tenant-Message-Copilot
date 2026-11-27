"use client";
import { useState } from "react";
import type { Fix } from "@/db/diagnostics";
import { Button } from "../components/ui/Button";
import { cx } from "../components/ui/cx";

/** The fix for one failed check, as a PowerShell command and a bash command, with a copy button. */
export default function FixBlock({ fix }: { fix: Fix }) {
  const [shell, setShell] = useState<"powershell" | "bash">("powershell");
  const [copied, setCopied] = useState(false);
  const cmd = fix[shell];
  const copy = async () => { try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  return (
    <div className="mt-1.5 max-w-2xl">
      <div role="tablist" aria-label="Shell" className="flex gap-4">
        {(["powershell", "bash"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={shell === k} onClick={() => setShell(k)} className={cx("t min-h-11 text-sm font-medium md:min-h-7", shell === k ? "text-text underline underline-offset-4 decoration-accent" : "text-muted hover:text-text")}>{k === "powershell" ? "PowerShell" : "bash"}</button>)}
      </div>
      <div className="flex items-start gap-2"><pre tabIndex={0} role="region" aria-label="Command to run" className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 font-mono text-sm text-text">{cmd}</pre><Button small onClick={copy}>{copied ? "Copied" : "Copy"}</Button></div>
    </div>
  );
}
