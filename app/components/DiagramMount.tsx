"use client";
import { useEffect, useRef } from "react";

/** Attaches a static SVG string after hydration. The server renders an empty box of the right shape (no layout shift); React never owns the
 *  <svg> children, so extension-written attributes on them cannot cause hydration warnings. `svg` is static markup built in code, never user input. */
export default function DiagramMount({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = svg; }, [svg]);
  return <div ref={ref} suppressHydrationWarning className="aspect-[736/200] w-full" />;
}
