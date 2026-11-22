import path from "node:path";
import { getEnv, parseEnv, rawEnv, type RawEnv } from "@/core/env";
import type { LLMProvider } from "@/core/provider";
import { AnthropicProvider } from "@/core/providers/anthropic";
import { openAICompatFromEnv } from "@/core/providers/openai-compat";
import { MockProvider } from "@/core/providers/mock";
import { ReplayProvider } from "@/core/providers/replay";

export const FIXTURES = path.join(process.cwd(), "evals", "fixtures", "recorded.json");

/**
 * LLM_PROVIDER picks the live backend: "openai_compat" (Groq and other OpenAI-compatible endpoints; default)
 * or "anthropic". Live needs that backend's key; without one the server falls back to replay, which fails safe
 * to a template reply when nothing is recorded.
 */
export type Backend = "openai_compat" | "anthropic";
export const backend = (env: RawEnv = rawEnv()): Backend => parseEnv(env, { crossCheck: false }).LLM_PROVIDER;
export const liveConfigured = (env: RawEnv = rawEnv()) => { const e = parseEnv(env, { crossCheck: false }); return e.LLM_PROVIDER === "anthropic" ? !!e.ANTHROPIC_API_KEY : !!e.LLM_API_KEY; };

/** Production never reaches the mock provider (core/env.ts rejects it at boot). A live outage is handled by the pipeline, never by a silent swap. */
export function createProvider(): LLMProvider {
  const mode = getEnv().PROVIDER_MODE;
  if (mode === "mock") return new MockProvider();
  if (mode === "live") return backend() === "anthropic" ? new AnthropicProvider() : openAICompatFromEnv();
  return new ReplayProvider(FIXTURES);
}
