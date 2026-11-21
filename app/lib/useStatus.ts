"use client";
import { useEffect, useState } from "react";
import type { StatusView } from "./types";

/** Loads /api/demo/status once per page view (the server caches the provider check for 60 s). */
export function useStatus() {
  const [s, setS] = useState<StatusView | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { fetch("/api/demo/status").then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then(setS).catch(() => setErr(true)); }, []);
  return { s, err };
}
