import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script helper without types
import { normalizeWaitPath } from "../scripts/lib/wait-path.mjs";

describe("with-server --wait path", () => {
  it("accepts api/health, /api/health and the path Git Bash on Windows produces from /api/health", () => {
    for (const raw of ["api/health", "/api/health", "C:/Program Files/Git/api/health", "C:\\Program Files\\Git\\api/health", "D:/a/tool/Git/api/health"]) expect(normalizeWaitPath(raw), raw).toBe("/api/health");
  });
  it("defaults to / and never returns a double slash", () => {
    expect(normalizeWaitPath(undefined)).toBe("/"); expect(normalizeWaitPath("//api/ready")).toBe("/api/ready");
  });
});
