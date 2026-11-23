"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copyFor } from "../lib/problem-copy";
import SetupCommands from "./SetupCommands";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";

export interface ProblemView { code?: string; hint?: string; host?: string; port?: number; missing?: string[]; reference?: string }

/** One designed error panel for every failure: code-specific title, what happened, what to do, the hint, a reference id with
 *  a copy button, "Check again", and (development only) a link to /setup. */
export default function ProblemPanel({ problem, dev, onRetry, className }: { problem: ProblemView; dev?: boolean; onRetry?: () => void; className?: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const c = copyFor(problem.code);
  const details = [`code: ${problem.code ?? "unexpected"}`, problem.reference && `reference: ${problem.reference}`, problem.host && `host: ${problem.host}${problem.port ? `:${problem.port}` : ""}`, problem.missing?.length && `missing: ${problem.missing.join(", ")}`].filter(Boolean).join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(details); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the details are visible text */ } };
  return (
    <EmptyState alert tone="error" title={c.title} reference={problem.reference} className={className}
      action={<div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onRetry ?? (() => router.refresh())}>Check again</Button>
        <Button onClick={copy}>{copied ? "Copied" : "Copy details"}</Button>
        {dev && <Link href="/setup" className="t inline-flex min-h-11 items-center px-2 text-base text-accent underline underline-offset-4 md:min-h-8">Open setup checklist</Link>}
      </div>}>
      <p>{c.what}</p>
      {dev ? <p><b className="font-medium text-text">What to do:</b> {c.todo}</p> : <p>The operator has been notified through the logs. Please try again shortly.</p>}
      {/* Production shows only the plain statement and the reference: no variable names, no commands. */}
      {dev && problem.hint && <p className="font-mono text-sm text-text">{problem.hint}</p>}
      {dev && problem.missing?.length ? <p className="text-sm">Missing: <code>{problem.missing.join(", ")}</code></p> : null}
      {dev && (problem.code === "config_missing" || problem.code === "schema_out_of_date") && <SetupCommands />}
    </EmptyState>
  );
}
