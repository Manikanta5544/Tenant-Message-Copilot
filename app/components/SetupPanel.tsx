"use client";
import { useState } from "react";
import { SETUP_COMMANDS } from "../lib/problem";
import { Button } from "./ui/Button";

/** Shown when seeded scenarios have no usable baseline run. In development it names the exact commands; in production it is a plain status. */
export default function SetupPanel({ missing, dev }: { missing: number; dev: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(SETUP_COMMANDS); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the command is selectable text */ }
  };
  if (!dev) {
    return (
      <div role="status" className="border-b border-border px-3 py-3">
        <h2 className="text-base font-semibold">Demo data is being prepared</h2>
        <p className="mt-0.5 text-sm text-muted">The sample drafts are not ready yet. Check back shortly.</p>
      </div>
    );
  }
  return (
    <div role="status" data-testid="setup-panel" className="border-b border-border px-3 py-3">
      <h2 className="text-base font-semibold">Setup needed</h2>
      <p className="mt-0.5 text-sm text-muted">{missing} demo scenario{missing === 1 ? " has" : "s have"} no saved draft. Apply the latest migrations and create the baselines, then reload.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 text-sm">{SETUP_COMMANDS}</code>
        <Button onClick={copy} aria-label="Copy setup commands">{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}
