// import { Chip, type Tone } from "./ui/Chip";

// const M: Record<string, { tone: Tone; hint: string }> = {
//   live: { tone: "ready", hint: "Responses come from a live model" },
//   replay: { tone: "fact", hint: "Replaying recorded real model responses" },
//   mock: { tone: "review", hint: "Deterministic mock provider, not a real model" },
//   fallback: { tone: "escalate", hint: "Template reply: the model path failed or was unavailable" },
// };
// export function ModeChip({ mode }: { mode: string }) {
//   const m = mode.toLowerCase(); const d = M[m] ?? M.mock!;
//   return <Chip tone={d.tone} title={d.hint} className="font-semibold">{m[0]!.toUpperCase() + m.slice(1)}</Chip>;
// }
