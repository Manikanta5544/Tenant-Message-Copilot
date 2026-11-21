// Deterministic UUIDs so demo scenarios, tests and evals are reproducible.
const k = { org: "01", resident: "02", lease: "03", clause: "04", event: "05", ledger: "06", message: "07" } as const;
export const uid = (kind: keyof typeof k, n: number) => `00000000-0000-4000-8000-${k[kind]}${String(n).padStart(10, "0")}`;

export const ORG_A = uid("org", 1);
export const ORG_B = uid("org", 2);
/** The organisation comes from server config, never from a request. */
export const DEMO_ORG_ID = ORG_A;

export const RES = {
  asha: uid("resident", 101), ravi: uid("resident", 102), meera: uid("resident", 103),
  imran: uid("resident", 201), vikram: uid("resident", 202), lakshmi: uid("resident", 204),
  sunita: uid("resident", 302), rohan: uid("resident", 911), priya: uid("resident", 912),
} as const;
