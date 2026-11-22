"use client";
import { useEffect, useState } from "react";
import { Button } from "./components/ui/Button";
import { EmptyState } from "./components/ui/EmptyState";

/** Route-level error boundary: no stack trace, a reference id the operator can find in the logs, and a retry. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Server render errors carry Next's digest (logged server-side next to the error). Client errors get a local id, logged to the console.
  const [ref] = useState(() => error.digest ?? crypto.randomUUID().slice(0, 8));
  useEffect(() => { console.error(JSON.stringify({ level: "error", msg: "ui error", ref, name: error.name })); }, [error, ref]);
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <EmptyState icon="alert" tone="error" alert title="Something went wrong" action={<Button variant="primary" onClick={reset}>Try again</Button>}>
        This page could not be shown. Nothing was sent to anyone. If it keeps happening, quote reference <span className="font-mono text-text">{ref}</span>.
      </EmptyState>
    </main>
  );
}
