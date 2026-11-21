import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import AppHeader from "./components/AppHeader";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions and the theme script set attributes on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body>
        <a href="#main" className="sr-only rounded-lg bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">Skip to content</a>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
