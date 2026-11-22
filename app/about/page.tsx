import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Icon } from "../components/ui/Icon";

export const metadata: Metadata = { title: "How it works · Tenant Message Copilot" };

const STEPS = [
  { icon: "inbox", t: "Read", d: "The tenant's message is cleaned and classified: language, intent, urgency. Keyword rules for legal, eviction, injection and safety terms run in parallel and can only raise the risk." },
  { icon: "search", t: "Gather evidence", d: "Code reads the tenant's own lease clauses and ledger. Balances and payments are computed in integer paise, then cross-checked by a second calculation." },
  { icon: "pencil", t: "Draft", d: "The model writes only plain words and references to evidence. It never types an amount, a date or a clause: code renders those from the evidence." },
  { icon: "shield", t: "Verify", d: "Six independent checks run on the draft. Failing one retries or blocks it." },
  { icon: "gauge", t: "Route", d: "The route is the most cautious of every signal. A model can make a run safer, never less safe." },
  { icon: "check", t: "Manager decides", d: "A person reads the draft with its evidence, then approves or edits it. The decision is recorded. Nothing is ever sent to a tenant." },
] as const;

const LAYERS = [
  ["Schema", "The model's output has exactly the allowed shape."],
  ["Evidence", "Every reference points to a fact that was actually gathered."],
  ["Exactness", "Amounts, dates and clause text match the evidence character for character."],
  ["Policy", "No promises, waivers, legal advice or other residents' data."],
  ["Semantic", "A second model checks that each sentence is supported. It can only lower trust."],
  ["Abstention", "If the evidence does not answer the question, the reply says so and asks a person."],
] as const;

const GUARANTEES = [
  ["lock", "Nothing is sent", "There is no send path in this application. Approving records a decision in a review log."],
  ["wallet", "Money is code, not prose", "All amounts are integer paise rendered by code from the ledger."],
  ["key", "Isolation in the database", "Row-level security limits every query to one organisation and one resident. It is not an application filter."],
  ["refresh", "Safe to retry", "Idempotency keys, atomic budgets and rate limits protect against double runs and runaway cost."],
] as const;

export default function About() {
  return (
    <main id="main" className="mx-auto max-w-[1100px] px-4 py-6 sm:py-8">
      <h1 className="text-2xl">How it works</h1>
      <p className="mt-1.5 max-w-prose text-base text-muted">Tenant Message Copilot drafts replies to tenant messages for a property manager. Every reply is grounded in the tenant's own lease and ledger, checked six ways, and routed by the most cautious signal.</p>

      <p role="note" className="mt-4 flex items-start gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2.5 text-base">
        <Icon name="info" size={18} className="mt-0.5 shrink-0 text-accent" />
        <span><b>All data is synthetic.</b> Residents, leases, payments and messages are made up for this demo. Nothing is ever sent to a tenant.</span>
      </p>

      <section aria-labelledby="pipeline" className="mt-8">
        <h2 id="pipeline" className="mb-3 text-xl">The pipeline</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.t}><Card className="h-full p-4">
              <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent"><Icon name={s.icon} size={16} /></span><h3 className="text-lg"><span className="num text-muted">{i + 1}. </span>{s.t}</h3></div>
              <p className="mt-2 text-base text-muted">{s.d}</p>
            </Card></li>
          ))}
        </ol>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="layers">
          <h2 id="layers" className="mb-3 text-xl">Six verification layers</h2>
          <Card className="p-2"><ol className="divide-y divide-border">
            {LAYERS.map(([n, d], i) => <li key={n} className="flex gap-3 p-2.5"><Chip tone="accent">{i + 1}</Chip><span className="text-base"><b>{n}.</b> <span className="text-muted">{d}</span></span></li>)}
          </ol></Card>
        </section>
        <section aria-labelledby="routes">
          <h2 id="routes" className="mb-3 text-xl">Three routes</h2>
          <Card className="space-y-3 p-4 text-base">
            <p className="flex items-start gap-2"><span className="shrink-0"><Chip tone="ready" icon="check">Draft ready</Chip></span><span className="text-muted">Every check passed. A person still reads it.</span></p>
            <p className="flex items-start gap-2"><span className="shrink-0"><Chip tone="review" icon="alert">Needs review</Chip></span><span className="text-muted">Money, balances, payment disputes or anything unclear. Check the highlighted values.</span></p>
            <p className="flex items-start gap-2"><span className="shrink-0"><Chip tone="escalate" icon="ban">Escalate only</Chip></span><span className="text-muted">Legal threats, eviction, deposit disputes, other residents' data, injection attempts. No draft is offered.</span></p>
          </Card>
        </section>
      </div>

      <section aria-labelledby="guarantees" className="mt-8">
        <h2 id="guarantees" className="mb-3 text-xl">Safety guarantees</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GUARANTEES.map(([icon, t, d]) => <li key={t}><Card className="h-full p-4"><Icon name={icon} size={18} className="text-accent" /><h3 className="mt-2 text-lg">{t}</h3><p className="mt-1 text-base text-muted">{d}</p></Card></li>)}
        </ul>
      </section>

      <p className="mt-8 text-base text-muted">See it work on the <Link href="/" className="text-accent underline underline-offset-2">inbox</Link>, or read the measured results on the <Link href="/evals" className="text-accent underline underline-offset-2">evals page</Link>.</p>
    </main>
  );
}
