import type { Metadata } from "next";
import Link from "next/link";
import DiagramMount from "../components/DiagramMount";
import { Dot } from "../components/ui/Dot";
import { Table } from "../components/ui/Table";

export const metadata: Metadata = { title: "About" };

const STEPS = [
  ["Read", "The tenant's message is cleaned and classified for language, intent and urgency; keyword rules for legal, eviction, injection and safety terms run alongside and can only raise the risk."],
  ["Gather evidence", "Code reads the tenant's own lease clauses and ledger, computes balances in integer paise and cross-checks them with a second calculation."],
  ["Draft", "The model writes only plain words and references to evidence; code renders every amount, date and clause quote from that evidence."],
  ["Verify", "Six independent checks run on the draft; a failure retries once, then blocks the model's text."],
  ["Route", "The route is the most cautious of every signal, so a model can make a run safer and never less safe."],
  ["Manager decides", "A person reads the draft beside its evidence, then approves or edits it; the decision is recorded and nothing is ever sent to a tenant."],
] as const;

const LAYERS = [
  ["1", "Schema", "The model's output has exactly the allowed shape.", "One retry, then a standard reply and a person."],
  ["2", "Evidence", "Every reference points to a fact that was gathered for this resident and applies today.", "One retry, then a standard reply and a person."],
  ["3", "Exactness", "No figures in the model's words; the balance matches the SQL view.", "One retry; a balance mismatch blocks the draft and escalates."],
  ["4", "Policy", "The topic is allowed; keyword floors for legal, eviction, deposit and safety terms are applied.", "The route is raised to review or escalate-only."],
  ["5", "Semantic", "A second model checks that each sentence follows from the cited facts. It can only lower trust.", "Needs review, with the unsupported sentences listed."],
  ["6", "Abstention", "The evidence can establish the claim being answered.", "The reply says so and a person decides."],
] as const;

const ROUTES = [
  ["ready", "Draft ready", "Every check passed.", "A reply is drafted.", "Read, check the values, approve."],
  ["review", "Needs review", "Money, a payment dispute, or anything unclear.", "A reply is drafted with its values highlighted.", "Check each value, edit, then approve."],
  ["escalate", "Escalate only", "Legal threats, eviction, deposit disputes, other residents' data, injection attempts.", "No reply is drafted.", "Handle it yourself."],
] as const;

/** One editorial page: the pipeline, a diagram of who does what (code or model), the six checks, the three routes. */
export default function About() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-4 py-8 outline-none md:px-6">
      <h1 className="text-2xl">How it works</h1>
      <p className="mt-3 max-w-[62ch] text-lg text-muted">Tenant Message Copilot drafts replies to tenant messages for a property manager. Each reply is grounded in the tenant's own lease and ledger, checked six ways, and routed by the most cautious signal.</p>
      <p className="mt-3 max-w-[62ch] text-base">All data is synthetic: residents, leases, payments and messages are made up for this demo. Nothing is ever sent to a tenant.</p>

      <section aria-labelledby="pipeline" className="mt-10">
        <h2 id="pipeline" className="text-xl">The pipeline</h2>
        <ol className="mt-3 divide-y divide-border border-y border-border">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[1.75rem_1fr] gap-x-2 py-3 sm:grid-cols-[1.75rem_9rem_1fr]">
              <span className="tnum text-muted">{i + 1}</span>
              <span className="font-semibold">{t}</span>
              <span className="col-span-2 mt-0.5 text-muted sm:col-span-1 sm:mt-0">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="diagram" className="mt-10">
        <h2 id="diagram" className="text-xl">Who does what</h2>
        <p className="mt-1 max-w-[62ch] text-muted">Solid boxes are ordinary code. Dashed boxes call a model, and everything a model produces is checked by the code that follows it.</p>
        <Diagram />
      </section>

      <section aria-labelledby="layers" className="mt-10">
        <h2 id="layers" className="text-xl">Six verification layers</h2>
        <div className="mt-3"><Table caption="Verification layers: what each checks and what happens when it fails" minWidth={560}>
          <thead><tr><th scope="col">#</th><th scope="col">Layer</th><th scope="col">What it checks</th><th scope="col">If it fails</th></tr></thead>
          <tbody>{LAYERS.map(([n, l, w, f]) => <tr key={l}><td className="tnum text-muted">{n}</td><td className="font-medium">{l}</td><td>{w}</td><td className="text-muted">{f}</td></tr>)}</tbody>
        </Table></div>
      </section>

      <section aria-labelledby="routes" className="mt-10">
        <h2 id="routes" className="text-xl">Three routes</h2>
        <div className="mt-3"><Table caption="The three routes, when each applies and what the manager sees" minWidth={560}>
          <thead><tr><th scope="col">Route</th><th scope="col">When</th><th scope="col">What you get</th><th scope="col">Your move</th></tr></thead>
          <tbody>{ROUTES.map(([s, l, w, g, m]) => <tr key={l}><td className="whitespace-nowrap font-medium"><Dot status={s} label={l} /></td><td>{w}</td><td className="text-muted">{g}</td><td className="text-muted">{m}</td></tr>)}</tbody>
        </Table></div>
      </section>

      <p className="mt-10 text-muted">See it work in the <Link href="/" className="text-accent underline underline-offset-4">inbox</Link>, or read the measured results on the <Link href="/evals" className="text-accent underline underline-offset-4">evals page</Link>.</p>
    </main>
  );
}

// Theme-aware plain SVG: strokes and fills come from the tokens through Tailwind classes. Hidden on phones, where the numbered list says the same.
// It is built as one static string and attached after hydration (DiagramMount), so React never hydrates the <svg> children that browser extensions such as
// Dark Reader rewrite. The markup is static and contains no user data.
const BOX = "fill-surface stroke-border-strong";
function diagramSvg(): string {
  const boxes: [string, string, number, number, boolean][] = [
    ["Message", "tenant writes", 0, 0, false], ["Read", "language, intent, urgency", 1, 0, true], ["Evidence", "lease and ledger", 2, 0, false], ["Draft", "words and references", 3, 0, true],
    ["Verify", "six layers", 3, 1, false], ["Route", "most cautious signal", 2, 1, false], ["Manager", "approve or edit", 1, 1, false],
  ];
  const X = (c: number) => 8 + c * 180, Y = (r: number) => 8 + r * 96;
  const arrow = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="stroke-border-strong" stroke-width="1.25" marker-end="url(#arr)"/>`;
  const g = boxes.map(([t, sub, c, r, model]) => `<g><rect x="${X(c)}" y="${Y(r)}" width="156" height="64" rx="6" class="${BOX}" stroke-width="1.25"${model ? ' stroke-dasharray="5 4"' : ""}/><text x="${X(c) + 12}" y="${Y(r) + 28}" class="fill-text" font-size="14" font-weight="600">${t}</text><text x="${X(c) + 12}" y="${Y(r) + 47}" class="fill-muted" font-size="11.5">${sub}</text></g>`).join("");
  const lines = [0, 1, 2].map((c) => arrow(X(c) + 156, Y(0) + 32, X(c + 1) - 3, Y(0) + 32)).join("") + arrow(X(3) + 78, Y(0) + 64, X(3) + 78, Y(1) - 3) + [3, 2].map((c) => arrow(X(c), Y(1) + 32, X(c - 1) + 159, Y(1) + 32)).join("");
  return `<svg role="img" aria-labelledby="dg-t dg-d" viewBox="0 0 736 200" class="h-auto w-full"><title id="dg-t">Pipeline diagram</title><desc id="dg-d">Message, read, evidence and draft run left to right. The draft goes down to verify, then right to left through route to the manager.</desc><defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" class="fill-border-strong"/></marker></defs>${g}${lines}</svg>`;
}
function Diagram() {
  return (
    <figure className="mt-3 hidden sm:block">
      <DiagramMount svg={diagramSvg()} />
      <figcaption className="mt-1 text-sm text-muted">The semantic check in Verify also calls a model, but it can only lower trust.</figcaption>
    </figure>
  );
}
