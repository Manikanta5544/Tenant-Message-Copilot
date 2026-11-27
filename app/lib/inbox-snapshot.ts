import type { InboxRow } from "./types";

// The last inbox the page loaded, kept for the command palette. The palette used to fetch /api/inbox only after it opened, so for as long as that
// request took (hundreds of ms to a remote database) it had no messages to offer and Enter did nothing.
let snapshot: InboxRow[] = [];
export const setInboxSnapshot = (rows: InboxRow[]): void => { snapshot = rows; };
export const getInboxSnapshot = (): InboxRow[] => snapshot;
