import Link from "next/link";
import { EmptyState } from "./components/ui/EmptyState";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <EmptyState icon="search" title="Page not found" action={<Link href="/" className="t inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-base font-medium text-accent-fg hover:bg-accent-hover">Back to the inbox</Link>}>
        There is no page at this address.
      </EmptyState>
    </main>
  );
}
