// The one place that reads NODE_ENV for UI decisions (the D6 lint rule forbids process.env elsewhere).
// Next.js inlines NODE_ENV at build time, so this is safe to import from client components.
export const isDev = (): boolean => process.env.NODE_ENV !== "production";
