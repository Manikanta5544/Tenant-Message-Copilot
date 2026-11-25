import { describe, expect, it } from "vitest";
import { classifyStyleCause, type OriginState } from "../app/lib/style-cause";

const base: OriginState = { swControlled: false, swRegistrations: 0, cacheStorageNames: [], extensionMarkers: [], sheets: [{ href: "http://localhost:3000/_next/static/chunks/a.css", loadedMedia: 4, freshMedia: 4 }] };
const sheet0 = base.sheets[0]!;
const stale = { ...sheet0, loadedMedia: 2 };

describe("classifyStyleCause", () => {
  it("service worker wins over a stale cache and an extension", () => {
    expect(classifyStyleCause({ ...base, swRegistrations: 1, sheets: [stale], extensionMarkers: ["data-darkreader-mode"] }).cause).toBe("service-worker");
    expect(classifyStyleCause({ ...base, swControlled: true }).cause).toBe("service-worker");
  });
  it("stale cache beats an extension", () => {
    const r = classifyStyleCause({ ...base, sheets: [stale], extensionMarkers: ["style.darkreader"] });
    expect(r.cause).toBe("stale-cache");
    expect(r.advice).toMatch(/Reset site data/);
  });
  it("extension only when every sheet matches the server's file", () => {
    expect(classifyStyleCause({ ...base, extensionMarkers: ["style.darkreader"] }).cause).toBe("extension");
  });
  it("a sheet that could not be re-fetched is not evidence of staleness", () => {
    expect(classifyStyleCause({ ...base, sheets: [{ ...sheet0, freshMedia: null }] }).cause).toBe("unknown");
  });
  it("unknown says what to do next", () => {
    const r = classifyStyleCause(base);
    expect(r.cause).toBe("unknown");
    expect(r.advice).toMatch(/private window/);
    expect(r.advice).toMatch(/copy the diagnostics/);
  });
});
