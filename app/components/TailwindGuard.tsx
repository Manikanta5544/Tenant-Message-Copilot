"use client";
import { useEffect } from "react";

/** Development only: warns once in the console when Tailwind utilities are missing (an unstyled page), instead of leaving the developer guessing. */
export default function TailwindGuard() {
  useEffect(() => {
    const probe = document.createElement("div");
    probe.className = "hidden";
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
    const broken = getComputedStyle(probe).display !== "none";
    probe.remove();
    if (broken) console.warn("Tailwind utilities are missing: the page will look unstyled. See README, Troubleshooting: move the folder to a short path without spaces or brackets (for example C:\\dev\\tenant-copilot), delete .next and restart.");
  }, []);
  return null;
}
