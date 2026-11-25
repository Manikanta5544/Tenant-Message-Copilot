/** "Try again at 14:05" from a Retry-After in seconds, in the viewer's local time. Pure so it can be tested with a fixed clock and zone. */
export function resetNote(retryAfterS: unknown, now: Date = new Date(), timeZone?: string): string {
  const s = Number(retryAfterS);
  if (!Number.isFinite(s) || s <= 0) return "";
  const at = new Date(now.getTime() + s * 1000);
  const t = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(at);
  return ` You can try again at ${t}.`;
}
