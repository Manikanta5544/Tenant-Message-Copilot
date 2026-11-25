"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { isPaletteKey } from "../lib/palette";

const Palette = dynamic(() => import("./CommandPalette"), { ssr: false });

/** Keeps the palette's code out of the first page load: the first Ctrl/Cmd+K (or "tmc:palette") loads it and opens it. */
export default function PaletteLoader() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (on) return;
    const key = (e: KeyboardEvent) => { if (isPaletteKey(e)) { e.preventDefault(); setOn(true); } };
    const ext = () => setOn(true);
    window.addEventListener("keydown", key); window.addEventListener("tmc:palette", ext);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("tmc:palette", ext); };
  }, [on]);
  return on ? <Palette startOpen /> : null;
}
