import Link from "next/link";
import { EmptyState } from "./components/ui/EmptyState";

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-12 outline-none">
      <EmptyState title="Page not found" action={<Link href="/" className="t inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-base font-medium text-accent-fg hover:bg-accent-hover md:min-h-8">Back to the inbox</Link>}>
        <p>There is no page at this address.</p>
      </EmptyState>
    </main>
  );
}
