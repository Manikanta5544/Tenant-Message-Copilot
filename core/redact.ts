// Redacted view for trace payloads shown in the interface. Deny-list of keys that could carry
// prompts, reasoning or credentials; long strings are truncated. Defence in depth: the pipeline never
// puts those in a payload in the first place.
const DENY = /^(prompt|system|messages?|chain_of_thought|reasoning|thinking|scratchpad|api_?key|authorization|secret|password|credential|token_value)$/i;
const MAX_STR = 300;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth limit]";
  if (typeof value === "string") return value.length > MAX_STR ? value.slice(0, MAX_STR) + "…" : value.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !DENY.test(k)).map(([k, v]) => [k, redact(v, depth + 1)]));
  }
  return value;
}
