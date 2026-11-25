/** Measures whether the page's CSS is doing what the build says it should, using throwaway probe elements. Client only. */
export interface StyleReport {
  ok: boolean;
  problems: string[];
  diagnostics: Record<string, string | number | boolean | string[]>;
}

const probe = (cls: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = cls; el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:-9999px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none";
  document.body.appendChild(el);
  return el;
};

export function extensionMarkers(): string[] {
  const root = document.documentElement;
  return [...root.getAttributeNames().filter((n) => n.startsWith("data-darkreader")), ...(document.querySelector("style.darkreader") ? ["style.darkreader"] : []), ...(document.querySelector("[data-grammarly-shadow-root],[cz-shortcut-listen]") ? ["other extension attributes"] : [])];
}

export function measureStyles(): StyleReport {
  const problems: string[] = [];
  const w = window.innerWidth;
  const desktop = w >= 768;
  const root = document.documentElement;
  const rootPx = parseFloat(getComputedStyle(root).fontSize);

  // 1. Utility CSS exists at all.
  const hidden = probe("hidden"); const utilOk = getComputedStyle(hidden).display === "none"; hidden.remove();
  if (!utilOk) problems.push("utility classes are not applied (the stylesheet is missing, stale or rewritten)");
  // 2. A responsive utility follows the px breakpoint: `hidden md:block` is block from 768 px, none below.
  const md = probe("hidden md:block"); const mdDisplay = getComputedStyle(md).display; md.remove();
  if (utilOk && mdDisplay !== (desktop ? "block" : "none")) problems.push(`the md: breakpoint is not applied (width ${w}px, expected display ${desktop ? "block" : "none"}, got ${mdDisplay})`);
  // 3. The plain-CSS skeleton: the rail is a 56 px column from 768 px.
  const rail = probe("rail"); const rs = getComputedStyle(rail); const railCol = rs.flexDirection === "column";
  rail.remove();
  if (desktop !== railCol) problems.push(`the layout skeleton does not match the viewport (width ${w}px: rail is ${railCol ? "a column" : "a row"})`);
  // 4. px versus rem: with an enlarged browser font these two disagree, which is exactly what px breakpoints avoid.
  const pxMatch = matchMedia("(min-width: 768px)").matches, remMatch = matchMedia("(min-width: 48rem)").matches;

  const markers = extensionMarkers();
  const rules = [...document.styleSheets].map((s) => { try { return s.cssRules.length; } catch { return -1; } });
  return {
    ok: problems.length === 0,
    problems,
    diagnostics: {
      innerWidth: w, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio, rootFontPx: rootPx,
      "(min-width:768px)": pxMatch, "(min-width:48rem)": remMatch, pxVsRemAgree: pxMatch === remMatch,
      dataLayout: root.dataset.layout ?? "unset", stylesheetRuleCounts: rules.map(String), extensionMarkers: markers, userAgent: navigator.userAgent,
    },
  };
}
