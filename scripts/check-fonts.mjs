// Runs before `next build`. The app uses next/font/google (Inter, Source Serif 4, JetBrains Mono), which downloads
// font CSS at build time. Without internet that ends in a long stack trace; fail early with a plain message instead.
if (process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES || process.env.SKIP_FONT_CHECK === "1") process.exit(0);
try {
  const r = await fetch("https://fonts.googleapis.com/css2?family=Inter&display=swap", { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.error(`\nThe build needs to download Google Fonts once and cannot reach fonts.googleapis.com (${e?.cause?.code ?? e?.message ?? e}).\n` +
    `  - Check your internet connection, VPN or proxy, then run the build again.\n` +
    `  - Offline? Set SKIP_FONT_CHECK=1 only if Next.js already cached the fonts from an earlier online build,\n` +
    `    or point NEXT_FONT_GOOGLE_MOCKED_RESPONSES at a JS module mapping each font URL to CSS (see the Next.js docs).\n` +
    `    PowerShell: $env:SKIP_FONT_CHECK="1"; npm run build\n`);
  process.exit(1);
}
