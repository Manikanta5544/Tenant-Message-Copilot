import path from "node:path";
import { providerMode } from "@/core/config";
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
export const backend = (env = process.env): Backend => (env.LLM_PROVIDER === "anthropic" ? "anthropic" : "openai_compat");
export const liveConfigured = (env = process.env) => (backend(env) === "anthropic" ? !!env.ANTHROPIC_API_KEY : !!env.LLM_API_KEY);

export function createProvider(): LLMProvider {
  const mode = providerMode();
  if (mode === "mock") return new MockProvider();
  if (mode === "live" && liveConfigured()) return backend() === "anthropic" ? new AnthropicProvider() : openAICompatFromEnv();
  return new ReplayProvider(FIXTURES);
}
