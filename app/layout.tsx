import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import AppHeader from "./components/AppHeader";
import { headers } from "next/headers";
import { bootStatus } from "@/core/env";
import "./globals.css";

// The CSP nonce is per request, so every page renders dynamically.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Tenant Message Copilot",
  // Tells the Dark Reader extension to leave this app alone: it ships its own dark theme.
  other: { "darkreader-lock": "" },
};
export const viewport: Viewport = { colorScheme: "light dark", width: "device-width", initialScale: 1 };

// Runs before first paint so the stored theme never flashes. Storage can throw (private windows, blocked cookies).
const THEME_INIT = `try{var t=localStorage.getItem("tmc-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const boot = bootStatus();
  return (
    // suppressHydrationWarning: browser extensions and the theme script set attributes on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <head><script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body>
        {boot.ok ? (
          <>
            <a href="#main" className="sr-only rounded-lg bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">Skip to content</a>
            <AppHeader />
            {children}
          </>
        ) : (
          // Misconfigured production boot (for example PROVIDER_MODE=mock): show maintenance, never a labelled-mock app. Details go to the logs and /api/ready.
          <main id="main" className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
            <div>
              <h1 className="text-xl font-semibold">Tenant Message Copilot</h1>
              <p className="mt-3 text-base text-muted" role="status">The service is in maintenance and will be back shortly. Nothing has been sent to anyone.</p>
            </div>
          </main>
        )}
      </body>
    </html>
  );
}
