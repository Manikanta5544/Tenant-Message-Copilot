"use client";
import { useEffect, useState } from "react";
import { Icon } from "./ui/Icon";

type Theme = "light" | "dark";
const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Header toggle. The choice is stored in localStorage (try/catch: storage can be blocked) and applied before paint by the layout script. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null); // null until mounted: server and first client render match
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "dark" || attr === "light" ? attr : systemDark() ? "dark" : "light");
  }, []);
  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tmc-theme", next); } catch { /* storage blocked: the choice lasts for this page only */ }
  };
  return (
    <button type="button" onClick={flip} disabled={theme === null} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}
      className="t grid size-11 place-items-center rounded-lg text-muted hover:bg-bg-subtle hover:text-text sm:size-9">
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}
