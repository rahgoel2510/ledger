/**
 * Record ids. `crypto.randomUUID` needs a secure context (HTTPS or localhost) —
 * both true for this app, but the fallback keeps a plain-HTTP LAN preview working.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
