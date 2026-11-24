// Runs once when the Next.js server starts. In development it prints one boxed, unmissable block of actionable lines
// when setup is incomplete (see instrumentation-node.ts). It never throws and never blocks startup.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV !== "production") {
    const { banner } = await import("./instrumentation-node");
    await banner();
  }
}
