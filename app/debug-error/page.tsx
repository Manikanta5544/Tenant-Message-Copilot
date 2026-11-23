import { notFound } from "next/navigation";
import { isDev } from "@/core/dev";
export const dynamic = "force-dynamic";
/** Development and e2e only (404 in production): throws on render so the error boundary can be exercised. */
export default function DebugError() {
  if (!isDev()) notFound();
  throw new Error("deliberate render error (debug-error)");
}
