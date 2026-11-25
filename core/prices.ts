// Plain constants so the browser bundle can show the price date without importing the provider.
/** ASSUMED list prices in micro-USD per million tokens, last reviewed 2026-11-23 (Groq on-demand list prices for the default models).
 *  Not fetched. Override with LLM_PRICES_JSON, for example {"openai/gpt-oss-120b":{"in":150000,"out":600000}}. */
export const ASSUMED_PRICES: Record<string, { in: number; out: number }> = {
  "openai/gpt-oss-20b": { in: 75_000, out: 300_000 },
  "openai/gpt-oss-120b": { in: 150_000, out: 600_000 },
};
export const ASSUMED_PRICES_DATE = "2026-11-23";
/** Used for a model with no known price: deliberately high, so an unpriced model depletes the budget faster, never slower. */
export const WORST_CASE_PRICE = { in: 3_000_000, out: 15_000_000 };

