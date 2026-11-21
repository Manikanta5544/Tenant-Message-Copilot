// Record and replay of REAL model responses. A recording is only ever produced by wrapping the live
// provider; replay serves it back, labelled "replay". A missing recording is a provider failure
// (template reply), never a made-up answer.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DraftSchema } from "../facts";
import { ADJUDICATE_SYSTEM, AdjudicationSchema, CHECK_SYSTEM, ClassificationSchema, DRAFT_SYSTEM, PROMPT_VERSION, ProviderError, SemanticResultSchema, TRIAGE_SYSTEM, type LLMProvider, type ProviderResult } from "../provider";

type Kind = "classify" | "draft" | "check" | "adjudicate";
interface Entry { kind: Kind; input_hash: string; result: ProviderResult<unknown>; recorded_at_model: string }
export type FixtureFile = { version: 1; entries: Record<string, Entry> };

/** Hash of every prompt and output schema: editing either invalidates old recordings even if PROMPT_VERSION was not bumped. */
export const PROMPT_FINGERPRINT = `${PROMPT_VERSION}:${createHash("sha256").update(JSON.stringify([TRIAGE_SYSTEM, DRAFT_SYSTEM, CHECK_SYSTEM, ADJUDICATE_SYSTEM, [ClassificationSchema, DraftSchema, SemanticResultSchema, AdjudicationSchema].map((x) => z.toJSONSchema(x))])).digest("hex").slice(0, 12)}`;
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
export const keyFor = (kind: Kind, input: unknown) => `${kind}:${createHash("sha256").update(canon([PROMPT_FINGERPRINT, input])).digest("hex").slice(0, 24)}`;

export function loadFixtures(file: string): FixtureFile {
  if (!fs.existsSync(file)) return { version: 1, entries: {} };
  return JSON.parse(fs.readFileSync(file, "utf8")) as FixtureFile;
}

export class RecordingProvider implements LLMProvider {
  readonly label = "live" as const;
  private fx: FixtureFile;
  constructor(private inner: LLMProvider, private file: string) { this.fx = loadFixtures(file); }
  private async rec(kind: Kind, input: unknown, run: () => Promise<ProviderResult<unknown>>) {
    const r = await run();
    this.fx.entries[keyFor(kind, input)] = { kind, input_hash: keyFor(kind, input), result: r, recorded_at_model: r.usage.model };
    return r;
  }
  flush() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.fx, null, 1)); }
  classify(i: Parameters<LLMProvider["classify"]>[0]) { return this.rec("classify", i, () => this.inner.classify(i)); }
  draft(i: Parameters<LLMProvider["draft"]>[0]) { return this.rec("draft", i, () => this.inner.draft(i)); }
  check(i: Parameters<LLMProvider["check"]>[0]) { return this.rec("check", i, () => this.inner.check(i)); }
  adjudicate(i: Parameters<LLMProvider["adjudicate"]>[0]) { return this.rec("adjudicate", i, () => this.inner.adjudicate(i)); }
}

export class ReplayProvider implements LLMProvider {
  readonly label = "replay" as const;
  private fx: FixtureFile;
  constructor(file: string) { this.fx = loadFixtures(file); }
  get size() { return Object.keys(this.fx.entries).length; }
  private get(kind: Kind, input: unknown): ProviderResult<unknown> {
    const e = this.fx.entries[keyFor(kind, input)];
    if (!e) throw new ProviderError("unavailable", `no recorded ${kind} response for this input`);
    return e.result;
  }
  async classify(i: Parameters<LLMProvider["classify"]>[0]) { return this.get("classify", i); }
  async draft(i: Parameters<LLMProvider["draft"]>[0]) { return this.get("draft", i); }
  async check(i: Parameters<LLMProvider["check"]>[0]) { return this.get("check", i); }
  async adjudicate(i: Parameters<LLMProvider["adjudicate"]>[0]) { return this.get("adjudicate", i); }
}
