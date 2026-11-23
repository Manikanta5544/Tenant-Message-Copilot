import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import StatusFooter from "./components/StatusFooter";
import TailwindGuard from "./components/TailwindGuard";
import LayoutProbe from "./components/LayoutProbe";
import { Rail } from "./components/ui/Rail";
import { cookies } from "next/headers";
import { bootStatus } from "@/core/env";
import "./globals.css";
import { isDev } from "@/core/dev";
import { rawEnv } from "@/core/env";

// The CSP nonce is per request, so every page renders dynamically.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

/** Absolute base for Open Graph URLs: the Vercel production domain when deployed, otherwise localhost. */
function siteUrl(): string {
  const e = rawEnv();
  const host = e.VERCEL_PROJECT_PRODUCTION_URL || e.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Tenant Message Copilot", template: "%s · Tenant Message Copilot" },
  openGraph: { type: "website", siteName: "Tenant Message Copilot", title: "Tenant Message Copilot", description: "A grounded draft reply for every tenant message, with the evidence and the route. Nothing is ever sent. Synthetic data." },
  twitter: { card: "summary_large_image", title: "Tenant Message Copilot" },
  description: "Tenant message in, grounded draft reply out, with the evidence and a route for a property manager. Nothing is ever sent to a tenant. Synthetic data only.",
};
export const viewport: Viewport = { colorScheme: "light dark", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const stored = (await cookies()).get("theme")?.value;
  const theme = stored === "light" || stored === "dark" ? stored : undefined; // no cookie: CSS prefers-color-scheme decides
  const boot = bootStatus();
  return (
    // suppressHydrationWarning on <html>, <body> and each <svg> (Icon): browser extensions (Dark Reader, Grammarly-style shortcuts) add attributes
    // to these elements before React hydrates. It only covers the element it sits on, so a real mismatch elsewhere is still reported.
    <html lang="en" suppressHydrationWarning data-theme={theme} className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <head>
        {/* A real element on purpose: Next.js drops an empty-string value in metadata.other, which silently disabled this opt-out.
            It tells the Dark Reader extension to leave the app alone (the app ships its own dark theme). */}
        <meta name="darkreader-lock" />
      </head>
      <body suppressHydrationWarning>
        <LayoutProbe />
        {isDev() && <TailwindGuard />}
        {boot.ok ? (
          <div className="flex h-dvh flex-col md:flex-row min-[1700px]:mx-auto min-[1700px]:max-w-[1600px] min-[1700px]:border-x min-[1700px]:border-border">
            <a href="#main" className="sr-only rounded-md bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60]">Skip to content</a>
            <Rail />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div id="scroll" className="min-h-0 flex-1 overflow-y-auto">{children}</div>
              <StatusFooter />
            </div>
          </div>
        ) : (
          // Misconfigured production boot (for example PROVIDER_MODE=mock): show maintenance, never a labelled-mock app. Details go to the logs and /api/ready.
          <main id="main" className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
            <div>
              <h1 className="text-xl font-semibold">Tenant Message Copilot</h1>
              <p className="mt-3 text-base text-muted" role="status">The service is in maintenance and will be back shortly. Nothing has been sent to anyone.</p>
              {isDev() && <p className="mt-3 text-sm text-muted">Development: the environment is invalid. <a href="/setup" className="text-accent underline underline-offset-4">Open the setup checklist</a>.</p>}
            </div>
          </main>
        )}
      </body>
    </html>
  );
}
