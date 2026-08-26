/**
 * IFSC branch lookup.
 *
 * Indian bank branches are identified by an 11-character IFSC, and the public
 * directory maps that to the bank name, branch, and address that have to appear
 * on the invoice's wire block. Typing them by hand is how a wrong branch ends up
 * on an invoice, so the code is the single thing entered and the rest is pulled.
 *
 * Three properties this must hold, in order of how badly they break the app:
 *
 * 1. **It never blocks.** The lookup is a convenience over a form that already
 *    accepts manual entry. Offline, rate-limited, or directory-down all resolve
 *    to `unavailable` and the user types the branch in — nothing is gated on it.
 * 2. **It sends the IFSC and nothing else.** An IFSC identifies a bank branch,
 *    not an account; it is printed on every cheque. The account number, the
 *    entity's name, and everything else in the profile stay local.
 * 3. **It does not re-ask.** Results are cached, because a branch address does
 *    not change between page loads and the profile form re-mounts on every visit
 *    to Settings.
 *
 * The cache lives in localStorage, not IndexedDB: this is public reference data
 * about someone else's bank, not the entity's books. Keeping it out of Dexie
 * keeps it out of the backup file and off the schema-version treadmill.
 */

/**
 * RBI format: 4-letter bank code, a reserved `0`, then 6 alphanumeric branch
 * characters. Validated before any request so a half-typed code never becomes a
 * network round-trip.
 */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const DIRECTORY_URL = "https://ifsc.razorpay.com";
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_PREFIX = "vrikshafx:ifsc:";

export interface IfscBranch {
  ifsc: string;
  bank: string;
  branch: string;
  address: string;
  city: string;
  state: string;
  /** The directory carries a SWIFT code for some branches and an empty string for most. */
  swift: string;
}

export type IfscLookup =
  | { status: "found"; branch: IfscBranch }
  | { status: "not-found" }
  | { status: "unavailable"; reason: string };

export function normalizeIfsc(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidIfscFormat(raw: string): boolean {
  return IFSC_PATTERN.test(normalizeIfsc(raw));
}

/** One-line summary for the form's confirmation row: "HDFC Bank — NEHRU PLACE, NEW DELHI". */
export function describeBranch(branch: IfscBranch): string {
  const place = [branch.branch, branch.city].filter(Boolean).join(", ");
  return place ? `${branch.bank} — ${place}` : branch.bank;
}

/**
 * Resolves an IFSC to its branch.
 *
 * Returns a result rather than throwing: every failure here is expected
 * operation (a typo, a plane, a directory outage) and the caller's response to
 * all of them is the same — show the reason, let the user type it in.
 */
export async function lookupIfsc(raw: string, signal?: AbortSignal): Promise<IfscLookup> {
  const code = normalizeIfsc(raw);
  if (!IFSC_PATTERN.test(code)) {
    return { status: "unavailable", reason: "An IFSC is 11 characters, like HDFC0000123." };
  }

  const cached = readCache(code);
  if (cached) return { status: "found", branch: cached };

  // Skip the request entirely when the browser already knows it is offline —
  // this app is expected to be used on a phone with no signal, and a failed
  // fetch there is normal, not an error worth surfacing as one.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "unavailable", reason: "You are offline — enter the branch details manually." };
  }

  try {
    const response = await fetch(`${DIRECTORY_URL}/${code}`, {
      signal: withTimeout(signal),
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) {
      return { status: "unavailable", reason: `The IFSC directory returned ${response.status}.` };
    }

    const branch = toBranch(code, await response.json());
    writeCache(code, branch);
    return { status: "found", branch };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "unavailable", reason: "The lookup timed out — enter the details manually." };
    }
    return {
      status: "unavailable",
      reason: "Could not reach the IFSC directory — enter the details manually.",
    };
  }
}

/**
 * The directory answers in SHOUTING CAPS keys. Everything is read defensively:
 * a missing field means an empty string on the form, never `undefined` leaking
 * into a controlled input.
 */
function toBranch(code: string, payload: unknown): IfscBranch {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");

  return {
    ifsc: text("IFSC") || code,
    bank: text("BANK"),
    branch: text("BRANCH"),
    address: text("ADDRESS"),
    city: text("CITY") || text("CENTRE"),
    state: text("STATE"),
    swift: text("SWIFT"),
  };
}

function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function readCache(code: string): IfscBranch | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + code);
    return raw ? (JSON.parse(raw) as IfscBranch) : undefined;
  } catch {
    // Private browsing, a full quota, or a hand-corrupted entry — treat a broken
    // cache as a cold one.
    return undefined;
  }
}

function writeCache(code: string, branch: IfscBranch): void {
  try {
    localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(branch));
  } catch {
    // A cache that cannot be written just means the next lookup refetches.
  }
}
