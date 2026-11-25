/** Names the most likely reason the page is using the wrong stylesheet, from facts about this origin. Client only (collectOriginState, resetSiteState); classifyStyleCause is pure. */
export interface SheetState { href: string; loadedMedia: number; freshMedia: number | null }
export interface OriginState {
  swControlled: boolean;
  swRegistrations: number;
  cacheStorageNames: string[];
  extensionMarkers: string[];
  sheets: SheetState[];
}
export type StyleCause = "service-worker" | "stale-cache" | "extension" | "unknown";
export interface CauseReport { cause: StyleCause; advice: string }

const countMedia = (rules: CSSRuleList): number => {
  let n = 0;
  for (const r of Array.from(rules)) {
    if (r instanceof CSSMediaRule) n += 1;
    const inner = (r as CSSGroupingRule).cssRules;
    if (inner) n += countMedia(inner);
  }
  return n;
};

/** Both counts come from the same file: the browser's parsed copy against a copy fetched past every cache. A difference means the cache served an old file. */
export async function collectOriginState(extensionMarkers: string[] = []): Promise<OriginState> {
  const regs = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations().catch(() => []) : [];
  const names = "caches" in window ? await caches.keys().catch(() => [] as string[]) : [];
  const sheets: SheetState[] = [];
  for (const s of Array.from(document.styleSheets)) {
    if (!s.href || new URL(s.href).origin !== location.origin) continue;
    let loadedMedia = 0;
    try { loadedMedia = countMedia(s.cssRules); } catch { continue; }
    let freshMedia: number | null = null;
    try {
      const res = await fetch(s.href, { cache: "reload" });
      if (res.ok) freshMedia = (await res.text()).match(/@media/g)?.length ?? 0;
    } catch { /* offline: leave unknown */ }
    sheets.push({ href: s.href, loadedMedia, freshMedia });
  }
  return { swControlled: !!navigator.serviceWorker?.controller, swRegistrations: regs.length, cacheStorageNames: names, extensionMarkers, sheets };
}

export function classifyStyleCause(s: OriginState): CauseReport {
  if (s.swControlled || s.swRegistrations > 0) {
    return { cause: "service-worker", advice: "A service worker from an earlier project on this address is answering requests with an old stylesheet. Reset site data to remove it." };
  }
  const stale = s.sheets.find((x) => x.freshMedia !== null && x.freshMedia !== x.loadedMedia);
  if (stale) {
    return { cause: "stale-cache", advice: `The browser is holding an old copy of ${new URL(stale.href).pathname} (it has ${stale.loadedMedia} media blocks, the server's file has ${stale.freshMedia}). Reset site data and reload.` };
  }
  if (s.extensionMarkers.length > 0) {
    return { cause: "extension", advice: `The stylesheet matches the server's file, but an extension (${s.extensionMarkers.join(", ")}) is rewriting the page. Turn the extension off for this site.` };
  }
  return { cause: "unknown", advice: "Nothing on this origin explains it. Open this address in a private window; if it looks right there, copy the diagnostics and send them with your browser name and version." };
}

/** Unregisters every service worker and deletes every Cache Storage entry, then reloads. */
export async function resetSiteState(): Promise<void> {
  if ("serviceWorker" in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
  location.reload();
}
