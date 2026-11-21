// Liveness only: no database, no model provider.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok" });
}
