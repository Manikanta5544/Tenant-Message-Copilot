"use client";
import { useState } from "react";
import { Button } from "./ui/Button";
import { cx } from "./ui/cx";

const SHELLS = {
  powershell: { label: "Windows PowerShell", lines: ["Copy-Item .env.example .env", "notepad .env", "npm run migrate", "npm run seed", "npm run dev"] },
  bash: { label: "macOS / Linux", lines: ["cp .env.example .env", "${EDITOR:-nano} .env", "npm run migrate", "npm run seed", "npm run dev"] },
} as const;
type Shell = keyof typeof SHELLS;

/** The five first-run commands, for PowerShell and bash, with a copy button. Development only (the callers gate it). */
export default function SetupCommands() {
  const [shell, setShell] = useState<Shell>(typeof navigator !== "undefined" && /Win/i.test(navigator.platform) ? "powershell" : "bash");
  const [copied, setCopied] = useState(false);
  const text = SHELLS[shell].lines.join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the commands are selectable text */ } };
  return (
    <div className="mt-2 max-w-xl">
      <div role="tablist" aria-label="Shell" className="flex gap-4 border-b border-border">
        {(Object.keys(SHELLS) as Shell[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={shell === k} onClick={() => setShell(k)} className={cx("t -mb-px min-h-11 border-b-2 text-sm font-medium md:min-h-8", shell === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text")}>{SHELLS[k].label}</button>
        ))}
      </div>
      <div className="mt-2 flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-bg-subtle p-2.5 font-mono text-sm leading-6 text-text">{text}</pre>
        <Button onClick={copy} aria-label="Copy setup commands">{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}
