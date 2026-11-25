"use client";
import { useEffect, useState } from "react";
import { Icon } from "./ui/Icon";

type Theme = "light" | "dark";
const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Theme toggle. The choice is a cookie (theme=light|dark, one year) that the root layout reads on the server and applies as data-theme on <html>:
 *  no inline script, no flash. With no cookie, CSS prefers-color-scheme decides. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null); // null until mounted: server and first client render match
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "dark" || attr === "light" ? attr : systemDark() ? "dark" : "light");
  }, []);
  useEffect(() => { const f = () => { const a = document.documentElement.getAttribute("data-theme"); setTheme(a === "dark" ? "dark" : a === "light" ? "light" : systemDark() ? "dark" : "light"); }; window.addEventListener("tmc:theme", f); return () => window.removeEventListener("tmc:theme", f); }, []);
  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { document.cookie = `theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`; } catch { /* cookies blocked: the choice lasts for this page only */ }
  };
  return (
    <button type="button" onClick={flip} disabled={theme === null} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}
      className="t grid size-11 place-items-center rounded-md text-muted hover:bg-bg-subtle hover:text-text md:size-9">
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}
