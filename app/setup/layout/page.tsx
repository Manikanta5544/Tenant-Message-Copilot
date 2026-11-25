import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDev } from "@/core/dev";
import LayoutLive from "./LayoutLive";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Layout check" };

/** Development-only live view of what the browser measures (viewport, root font, breakpoints, stylesheets, extension markers). 404 in production. */
export default function LayoutCheckPage() {
  if (!isDev()) notFound();
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-4 py-8 outline-none md:px-6">
      <h1 className="text-2xl">Layout check</h1>
      <p className="mt-2 max-w-[62ch] text-muted">Development only. Resize the window or change the browser font size: this updates live. If a row says "problem", open the app in a private window or run <code>npm run clean</code>.</p>
      <LayoutLive />
      <p className="mt-6 text-sm"><a href="/setup" className="text-accent underline underline-offset-4">Back to the setup checklist</a></p>
    </main>
  );
}
