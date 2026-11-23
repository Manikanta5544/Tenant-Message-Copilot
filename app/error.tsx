"use client";
import { useEffect, useState } from "react";
import ProblemPanel from "./components/ProblemPanel";
import { isDev } from "@/core/dev";

/** Route-level error boundary, for truly unexpected bugs only: expected failures (database, configuration) are handled in the page itself.
 *  No stack trace; a reference id the operator can find in the logs, a Copy details button and a retry. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Server render errors carry Next's digest (logged server-side next to the error). Client errors get a local id, logged to the console.
  const [ref] = useState(() => error.digest ?? crypto.randomUUID().slice(0, 8));
  useEffect(() => { console.error(JSON.stringify({ level: "error", msg: "ui error", ref, name: error.name })); }, [error, ref]);
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-12 outline-none">
      <ProblemPanel problem={{ code: "unexpected", reference: ref }} dev={isDev()} onRetry={reset} />
    </main>
  );
}
