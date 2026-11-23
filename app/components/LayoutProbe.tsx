"use client";
import { useEffect } from "react";
import { isDev } from "@/core/dev";

/** Sets <html data-layout="desktop|mobile"> from the same breakpoint the CSS uses (md = 48rem), for tests and the dev guard. Never used for styling.
 *  In development it also (a) warns if the DOM contradicts that layout (utilities not applied) and (b) shows a notice when a
 *  dark-mode extension is rewriting the page. */
export default function LayoutProbe() {
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const set = () => { document.documentElement.dataset.layout = mq.matches ? "desktop" : "mobile"; };
    set(); mq.addEventListener("change", set);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let note: HTMLElement | null = null;
    if (isDev()) {
      timer = setTimeout(() => {
        const labels = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Primary"] ul a')].filter((a) => a.getClientRects().length && a.innerText.trim()).length;
        if (mq.matches && labels > 0) console.warn("Layout check: the viewport is 768 px or wider but the mobile navigation labels are visible. Responsive CSS is not being applied: a browser extension (Dark Reader, Auto Dark Mode) or a stale .next folder is the usual cause. Try an Incognito window with extensions off.");
        const el = document.documentElement;
        const rewriting = el.getAttributeNames().some((n) => n.startsWith("data-darkreader")) || !!document.querySelector("style.darkreader");
        if (rewriting && !document.getElementById("ext-notice")) {
          note = document.createElement("div");
          note.id = "ext-notice"; note.setAttribute("role", "status");
          note.style.cssText = "position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:70;max-width:min(40rem,calc(100vw - 16px));padding:8px 12px;border:1px solid var(--border-strong);border-left:3px solid var(--review-fg);border-radius:6px;background:var(--surface-raised);color:var(--text);font:14px/1.4 system-ui,sans-serif";
          note.textContent = "A dark-mode extension is rewriting this page and can break the layout. Disable it for localhost.";
          note.addEventListener("click", () => note?.remove());
          document.body.appendChild(note);
        }
      }, 1500);
    }
    return () => { mq.removeEventListener("change", set); if (timer) clearTimeout(timer); note?.remove(); };
  }, []);
  return null;
}
