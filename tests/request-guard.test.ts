import { describe, expect, it } from "vitest";
import { guardStateChange } from "../core/request-guard";

const h = (o: Record<string, string>) => new Headers(o);
const json = { "content-type": "application/json" };
describe("state-changing API requests", () => {
  it("reads are never blocked", () => expect(guardStateChange("GET", h({}), "a.test")).toBeNull());
  it("415 for text/plain, form posts and a missing Content-Type", () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) expect(guardStateChange("POST", h(ct ? { "content-type": ct } : {}), "a.test")).toMatchObject({ status: 415 });
  });
  it("accepts application/json with a charset", () => expect(guardStateChange("POST", h({ "content-type": "application/json; charset=utf-8" }), "a.test")).toBeNull());
  it("403 for a cross-site fetch, by Sec-Fetch-Site or by Origin", () => {
    expect(guardStateChange("POST", h({ ...json, "sec-fetch-site": "cross-site" }), "a.test")).toMatchObject({ status: 403, code: "cross_site" });
    expect(guardStateChange("POST", h({ ...json, "sec-fetch-site": "same-site" }), "a.test")).toMatchObject({ status: 403 });
    expect(guardStateChange("POST", h({ ...json, origin: "https://evil.test" }), "a.test")).toMatchObject({ status: 403 });
    expect(guardStateChange("POST", h({ ...json, origin: "not a url" }), "a.test")).toMatchObject({ status: 403 });
  });
  it("allows same-origin browsers and header-less scripts", () => {
    expect(guardStateChange("POST", h({ ...json, "sec-fetch-site": "same-origin", origin: "https://a.test" }), "a.test")).toBeNull();
    expect(guardStateChange("POST", h(json), "a.test")).toBeNull();
  });
});
