import { describe, expect, it } from "vitest";
import { redact } from "../core/redact";
describe("trace redaction", () => {
  it("drops prompt, reasoning and credential keys at any depth, masks keys in strings, truncates long strings", () => {
    const out = JSON.stringify(redact({ stage: "x", prompt: "p", nested: { reasoning: "r", api_key: "k", Authorization: "a", fine: "ok sk-ant-api03-ABC_def" }, list: [{ system: "s", v: 1 }], long: "z".repeat(1000) }));
    expect(out).not.toMatch(/"prompt"|"reasoning"|api_key|Authorization|"system"|sk-ant/);
    expect(out).toContain('"fine":"ok [redacted]"');
    expect(out).toContain('"v":1');
    expect(out.length).toBeLessThan(600);
  });
  it("keeps route reasons, which are rule outputs and not model reasoning", () => {
    expect(JSON.stringify(redact({ reasons: ["intent table: needs_review"] }))).toContain("intent table");
  });
});
