import { db } from "@/lib/db";
import type { EntityProfile } from "@/lib/types";
import { enqueueSync } from "@/lib/sync";

/**
 * Invoice serial allocation: `{prefix}/{FY}/{seq}`, e.g. RGHUF/26-27/001.
 *
 * The sequence comes from a dedicated counter row, NOT from `max(sequence)` over
 * existing invoices. Deleting or voiding an invoice must never free its number
 * for reuse (module 1, US-1) — a gap in the series is expected and fine, a
 * duplicate serial is a compliance problem.
 */
export function counterKeyForFy(financialYear: string): string {
  return `invoice-seq:${financialYear}`;
}

/**
 * Used when the numbering settings are blank. Every field on the settings form
 * is optional, so a serial still has to be well-formed for a profile that was
 * saved half-filled — `//26-27/1` is not a serial anyone can file against.
 */
/**
 * `RGHUF` and not `RGHUF/INV`: Rule 46(b) caps a serial at 16 characters, and
 * `RGHUF/INV/26-27/001` is 19. `RGHUF/26-27/001` is 15 and says the same thing.
 * A prefix the user lengthens past the cap is flagged in Settings rather than
 * silently truncated — renumbering issued invoices is never the right fix.
 */
export const DEFAULT_SERIAL_PREFIX = "RGHUF";
export const DEFAULT_SERIAL_PADDING = 3;

export function formatSerialNumber(
  profile: Pick<EntityProfile, "invoiceSerialPrefix" | "invoiceSerialPadding">,
  financialYear: string,
  sequence: number
): string {
  const prefix = (profile.invoiceSerialPrefix || DEFAULT_SERIAL_PREFIX).trim().replace(/\/+$/, "");
  const digits = Number(profile.invoiceSerialPadding);
  const padding = Number.isFinite(digits) && digits >= 1 ? Math.floor(digits) : DEFAULT_SERIAL_PADDING;
  return `${prefix || DEFAULT_SERIAL_PREFIX}/${financialYear}/${String(sequence).padStart(padding, "0")}`;
}

/**
 * Consumes the next sequence for a financial year. Must run inside (or be
 * allowed to open) a readwrite transaction covering `counters` so two rapid
 * invoice saves can't hand out the same number.
 */
export async function allocateSequence(financialYear: string): Promise<number> {
  const key = counterKeyForFy(financialYear);
  return db.transaction("rw", db.counters, db.syncQueue, async (tx) => {
    const current = await db.counters.get(key);
    const next = (current?.value ?? 0) + 1;
    await db.counters.put({ key, value: next });
    await enqueueSync(tx, "counters", key);
    return next;
  });
}

/** What the next serial *would* be, without consuming it — for preview in the create form. */
export async function peekNextSerial(
  profile: Pick<EntityProfile, "invoiceSerialPrefix" | "invoiceSerialPadding">,
  financialYear: string
): Promise<string> {
  const current = await db.counters.get(counterKeyForFy(financialYear));
  return formatSerialNumber(profile, financialYear, (current?.value ?? 0) + 1);
}

/**
 * Raises the counter so it never sits below an already-issued serial. Used after
 * importing a backup, where invoices arrive without their counter rows.
 */
export async function reconcileCounters(): Promise<void> {
  const invoices = await db.invoices.toArray();
  const highest = new Map<string, number>();
  for (const invoice of invoices) {
    const seen = highest.get(invoice.financialYear) ?? 0;
    if (invoice.sequence > seen) highest.set(invoice.financialYear, invoice.sequence);
  }
  await db.transaction("rw", db.counters, async () => {
    for (const [fy, maxSequence] of highest) {
      const key = counterKeyForFy(fy);
      const current = await db.counters.get(key);
      if ((current?.value ?? 0) < maxSequence) {
        await db.counters.put({ key, value: maxSequence });
      }
    }
  });
}
