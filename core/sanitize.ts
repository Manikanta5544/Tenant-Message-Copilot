// Input hardening for tenant messages. Messages are data: they are normalised here, stored, and only ever
// rendered as text (React escaping; no dangerouslySetInnerHTML anywhere on message content).

/** Bidirectional controls that can visually reorder text (Trojan Source style), and invisible characters with no
 *  legitimate use in a message. U+200C/U+200D (ZWNJ/ZWJ) are kept: Hindi and Telugu conjuncts need them. */
const INVISIBLE = /[؜᠎​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// C0 and C1 controls except tab and newline (carriage returns are folded into newlines first).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function sanitizeMessage(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(INVISIBLE, "");
}
