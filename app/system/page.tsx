import type { Metadata } from "next";
import SystemLive from "./SystemLive";

export const metadata: Metadata = { title: "System" };

export default function SystemPage() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[900px] px-4 py-8 outline-none md:px-6">
      <h1 className="text-2xl">System</h1>
      <p className="mt-3 max-w-[62ch] text-muted">What the demo is doing right now: runs, latency, retries, model health and limits. Counts and timings only; no tenant or message content. Refreshes every 5 seconds.</p>
      <SystemLive />
    </main>
  );
}
