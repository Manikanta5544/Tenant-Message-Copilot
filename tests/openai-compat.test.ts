// Exercises the OpenAI-compatible provider over real HTTP against a local stub. This proves our request
// shaping, error mapping and parsing; it does NOT prove any hosted model (Groq etc.) behaves well.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAICompatProvider } from "../core/providers/openai-compat";
import { ProviderError } from "../core/provider";
import { closeAllPools } from "../db/client";
import { runMessage } from "../evals/harness";
import { APP_URL, HAS_DB, OWNER_URL } from "./helpers";

type Handler = (body: any, headers: http.IncomingHttpHeaders) => { status?: number; delayMs?: number; json?: unknown; raw?: string };
let server: http.Server; let base = ""; let handler: Handler = () => ({ json: {} }); const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];
const completion = (content: string, extra: object = {}) => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = ""; req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = JSON.parse(data || "{}"); seen.push({ headers: req.headers, body });
      const r = handler(body, req.headers);
      setTimeout(() => { res.statusCode = r.status ?? 200; res.setHeader("content-type", "application/json"); res.end(r.raw ?? JSON.stringify(r.json ?? {})); }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => { server.close(); await closeAllPools(); });

const mk = (over: object = {}) => new OpenAICompatProvider({ baseUrl: base, apiKey: "test-key-123", models: { triage: "small", draft: "big", check: "small" }, timeoutMs: { triage: 300, draft: 300, check: 300 }, ...over });
const input = { message: "hi", asOf: "2026-11-19", preferredLanguage: "English" as const };
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ProviderError ? e.kind : "other"; } };

describe("OpenAI-compatible provider over HTTP", () => {
  it("sends bearer auth, JSON mode and the schema; parses the JSON and maps usage", async () => {
    handler = () => ({ json: completion('{"a":1}') });
    const r = await mk().classify(input);
    expect(r.value).toEqual({ a: 1 });
    expect(r.usage).toMatchObject({ model: "small", tokens_in: 120, tokens_out: 30, cost_micro_usd: 0 });
    const s = seen.at(-1)!;
    expect(s.headers.authorization).toBe("Bearer test-key-123");
    expect(s.body.response_format).toEqual({ type: "json_object" });
    expect(s.body.messages[0].content).toContain("JSON Schema");
    expect(s.body.model).toBe("small");
    expect(JSON.stringify(s.body)).not.toContain("test-key-123");
  });
  it("computes cost from configured prices; free tier (no price) costs zero", async () => {
    handler = () => ({ json: completion("{}") });
    const r = await mk({ prices: { small: { in: 1_000_000, out: 5_000_000 } } }).classify(input);
    expect(r.usage.cost_micro_usd).toBe(Math.ceil((120 * 1_000_000 + 30 * 5_000_000) / 1e6));
    expect(mk().worstCaseCostMicroUsd()).toBe(0);
    expect(mk({ prices: { big: { in: 3e6, out: 15e6 } } }).worstCaseCostMicroUsd()).toBeGreaterThan(0);
  });
  it("strips one code fence but repairs nothing else", async () => {
    handler = () => ({ json: completion('```json\n{"ok":true}\n```') });
    expect((await mk().classify(input)).value).toEqual({ ok: true });
    handler = () => ({ json: completion('Sure! {"ok":true}') });
    expect(await kind(mk().classify(input))).toBe("malformed");
  });
  it("maps failures: 429 rate_limit, 500 unavailable, slow timeout, bad body malformed, truncated malformed, unreachable unavailable", async () => {
    handler = () => ({ status: 429, json: { error: "slow down sk-secret" } });
    expect(await kind(mk().classify(input))).toBe("rate_limit");
    handler = () => ({ status: 500, json: { error: "boom" } });
    expect(await kind(mk().draft({ message: "hi", language: "English", intent: "general_other", asOf: "2026-11-19", bundle: { residentId: "r", leaseId: null, asOf: "2026-11-19", facts: [] } }))).toBe("unavailable");
    handler = () => ({ delayMs: 1000, json: completion("{}") });
    expect(await kind(mk().classify(input))).toBe("timeout");
    handler = () => ({ raw: "<html>gateway</html>" });
    expect(await kind(mk().classify(input))).toBe("malformed");
    handler = () => ({ json: { choices: [{ message: { content: '{"a":' }, finish_reason: "length" }], usage: { prompt_tokens: 5, completion_tokens: 5 } } });
    expect(await kind(mk().classify(input))).toBe("malformed");
    expect(await kind(new OpenAICompatProvider({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", models: { triage: "a", draft: "a", check: "a" } }).classify(input))).toBe("unavailable");
  });
  it("never forwards the endpoint's error body (it can echo the request)", async () => {
    handler = () => ({ status: 401, json: { error: { message: "bad key test-key-123 and the prompt text" } } });
    try { await mk().classify(input); } catch (e) { expect((e as Error).message).not.toMatch(/test-key|prompt text/); }
  });
  it("refuses to construct without a key", () => {
    expect(() => new OpenAICompatProvider({ baseUrl: base, apiKey: "", models: { triage: "a", draft: "a", check: "a" } })).toThrow(/LLM_API_KEY/);
  });

  it.skipIf(!HAS_DB)("end to end: Scenario 1 through the pipeline over HTTP; the model's text is verified and the clause is rendered by code", async () => {
    handler = (body) => {
      const sys: string = body.messages[0].content, user: string = body.messages[1].content;
      if (sys.includes("You triage")) return { json: completion(JSON.stringify({ language: "English", intent: "maintenance_request", urgency: "normal", suspected_injection: false, claimed_amount_inr: null, claimed_date: null, claimed_reference: null, english_queries: ["dripping tap repair"], proposed_tools: ["search_lease_clauses"], suggested_route: "draft_ready" })) };
      if (sys.includes("You write a reply draft")) { const id = /(C\d+) \[clause\]/.exec(user)![1]; return { json: completion(JSON.stringify({ language: "English", segments: [{ type: "text", text: "Thanks for letting us know. " }, { type: "quote", id }, { type: "text", text: " A manager will review this reply." }] })) }; }
      return { json: completion(JSON.stringify({ supported: true, issues: [] })) };
    };
    const slow = new OpenAICompatProvider({ baseUrl: base, apiKey: "k", models: { triage: "small", draft: "big", check: "small" } });
    const r = await runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: slow, unit: "102", message: "The kitchen tap has been dripping since Monday.", asOf: "2026-11-19" });
    expect(r.output.route).toBe("draft_ready");
    expect(r.output.mode).toBe("live");
    expect(r.output.rendered.find((s) => s.type === "quote")!.text).toContain("acknowledge a maintenance request within 24 hours");
    expect(r.events.find((e) => e.stage === "triage")!.model).toBe("small");
  });
  it.skipIf(!HAS_DB)("a weak model that writes a figure in text is caught, retried, then escalated", async () => {
    handler = (body) => {
      const sys: string = body.messages[0].content;
      if (sys.includes("You triage")) return { json: completion(JSON.stringify({ language: "English", intent: "balance_question", urgency: "normal", suspected_injection: false, claimed_amount_inr: null, claimed_date: null, claimed_reference: null, english_queries: [], proposed_tools: ["get_balance_breakdown"], suggested_route: "needs_review" })) };
      return { json: completion(JSON.stringify({ language: "English", segments: [{ type: "text", text: "You owe 12000 rupees." }] })) };
    };
    const p = new OpenAICompatProvider({ baseUrl: base, apiKey: "k", models: { triage: "small", draft: "big", check: "small" } });
    const r = await runMessage({ appUrl: APP_URL!, ownerUrl: OWNER_URL!, provider: p, unit: "101", message: "What is my balance?", asOf: "2026-11-19" });
    expect(r.output.route).toBe("escalate_only");
    expect(r.output.draft_source).toBe("template");
    expect(r.events.filter((e) => e.stage === "draft")).toHaveLength(2);
  });
});

describe("retry on rate limit and server errors", () => {
  const fast = { retry: { sleep: async () => {}, maxWaitMs: 50 } };
  it("429 then 200: one retry succeeds and honours retry-after (capped)", async () => {
    let n = 0; const waits: number[] = [];
    handler = () => (++n === 1 ? { status: 429, json: { error: "rate" } } : { json: completion('{"a":1}') });
    const r = await mk({ retry: { sleep: async (ms: number) => { waits.push(ms); }, maxWaitMs: 50 } }).classify(input);
    expect(r.value).toEqual({ a: 1 }); expect(n).toBe(2); expect(waits.length).toBe(1); expect(waits[0]).toBeLessThanOrEqual(50);
  });
  it("503 then 200 also retries once", async () => {
    let n = 0; handler = () => (++n === 1 ? { status: 503 } : { json: completion('{"ok":true}') });
    expect((await mk(fast).classify(input)).value).toEqual({ ok: true }); expect(n).toBe(2);
  });
  it("429 twice gives up with rate_limit after exactly one retry", async () => {
    let n = 0; handler = () => { n++; return { status: 429 }; };
    expect(await kind(mk(fast).classify(input))).toBe("rate_limit"); expect(n).toBe(2);
  });
  it("a 400 is never retried", async () => {
    let n = 0; handler = () => { n++; return { status: 400 }; };
    expect(await kind(mk(fast).classify(input))).toBe("unavailable"); expect(n).toBe(1);
  });
  it("sends reasoning_effort and adds output headroom only when configured", async () => {
    handler = () => ({ json: completion('{"a":1}') });
    await mk({ reasoningEffort: "low", outputHeadroom: 1000 }).classify(input);
    expect(seen.at(-1)!.body.reasoning_effort).toBe("low");
    expect(seen.at(-1)!.body.max_tokens).toBe(1500);
    await mk().classify(input);
    expect(seen.at(-1)!.body.reasoning_effort).toBeUndefined();
  });
});
