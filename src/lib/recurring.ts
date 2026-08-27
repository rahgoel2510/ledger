import { db } from "@/lib/db";
import type { BillingCycle, Client, ClientBilling } from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";
import { addDays, todayIsoDate } from "@/lib/fy";
import { createInvoice } from "@/lib/invoices";
import { recordAudit } from "@/lib/audit";
import { getEntityProfile } from "@/lib/entity-profile";

/**
 * Retainer billing periods, and the drafts they raise.
 *
 * A period is only ever billed once it has fully elapsed — the app never invoices
 * for time that has not happened yet, and `lastDraftedPeriodStart` on the client
 * makes generation idempotent, so opening the app twice on the same morning
 * cannot produce two invoices for August.
 *
 * KNOWN COST, ACCEPTED DELIBERATELY: every auto-draft consumes an invoice serial
 * from the financial-year counter, and serials are never reissued (`serial.ts`).
 * A month that gets drafted and then deleted therefore leaves a permanent gap in
 * the series that has to be explained to the CA. The user was told this and chose
 * automatic drafting anyway; the mitigation is that only fully-elapsed periods
 * are drafted, and never the same one twice.
 */

export interface BillingPeriod {
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
}

export interface CyclePreset {
  id: string;
  label: string;
  cycle: BillingCycle;
}

export const CYCLE_PRESETS: CyclePreset[] = [
  { id: "weekly", label: "Weekly", cycle: { intervalUnit: "week", intervalCount: 1 } },
  { id: "fortnightly", label: "Fortnightly", cycle: { intervalUnit: "week", intervalCount: 2 } },
  { id: "monthly", label: "Monthly", cycle: { intervalUnit: "month", intervalCount: 1 } },
  { id: "quarterly", label: "Quarterly", cycle: { intervalUnit: "month", intervalCount: 3 } },
  { id: "half-yearly", label: "Half-yearly", cycle: { intervalUnit: "month", intervalCount: 6 } },
  { id: "yearly", label: "Yearly", cycle: { intervalUnit: "month", intervalCount: 12 } },
];

export const DEFAULT_CYCLE: BillingCycle = { intervalUnit: "month", intervalCount: 1 };

/** The preset id a cycle corresponds to, or "custom" for anything else. */
export function presetIdFor(cycle: BillingCycle | undefined): string {
  if (!cycle) return "monthly";
  const preset = CYCLE_PRESETS.find(
    (p) => p.cycle.intervalUnit === cycle.intervalUnit && p.cycle.intervalCount === cycle.intervalCount
  );
  return preset?.id ?? "custom";
}

export function describeCycle(cycle: BillingCycle): string {
  const preset = CYCLE_PRESETS.find((p) => presetIdFor(cycle) === p.id);
  if (preset) return preset.label;
  return `Every ${cycle.intervalCount} ${cycle.intervalUnit}s`;
}

/**
 * Adds one cycle to a date. Month arithmetic clamps to the end of a short month,
 * so a period anchored on the 31st bills on 28 February rather than rolling into
 * March and quietly shifting every subsequent period.
 */
export function addCycle(isoDate: string, cycle: BillingCycle): string {
  const [year, month, day] = isoDate.split("-").map(Number);

  if (cycle.intervalUnit === "week") {
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + cycle.intervalCount * 7);
    return date.toISOString().slice(0, 10);
  }

  const targetMonthIndex = month - 1 + cycle.intervalCount;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);

  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

function previousDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The period a date falls in, counting forward from the anchor. */
export function periodContaining(anchor: string, cycle: BillingCycle, date: string): BillingPeriod {
  let start = anchor;
  // Bounded: a cycle always advances, so this terminates on any real anchor.
  // Guarded anyway, because a corrupted zero-count cycle would otherwise hang.
  for (let i = 0; i < 5000; i += 1) {
    const next = addCycle(start, cycle);
    if (next <= start) break;
    if (next > date) break;
    start = next;
  }
  return { start, end: previousDay(addCycle(start, cycle)) };
}

/**
 * Periods that have fully elapsed and not yet been drafted. Returns them oldest
 * first, so a client left unopened for three months produces three drafts in
 * order rather than one lump nobody can reconcile.
 */
export function pendingPeriods(billing: ClientBilling, today = todayIsoDate()): BillingPeriod[] {
  if (billing.model !== "fixed" || !billing.autoDraft) return [];
  if (!billing.cycleAnchorDate || !billing.cycle) return [];
  if (billing.cycle.intervalCount < 1) return [];

  const periods: BillingPeriod[] = [];
  let start = billing.cycleAnchorDate;

  // Skip everything up to and including the last period already drafted.
  while (billing.lastDraftedPeriodStart && start <= billing.lastDraftedPeriodStart) {
    const next = addCycle(start, billing.cycle);
    if (next <= start) return [];
    start = next;
  }

  for (let i = 0; i < 240; i += 1) {
    const next = addCycle(start, billing.cycle);
    if (next <= start) break;
    // Not yet over — an unfinished retainer period is not billable.
    if (next > today) break;
    periods.push({ start, end: previousDay(next) });
    start = next;
  }

  return periods;
}

export interface GeneratedDraft {
  clientId: string;
  clientName: string;
  serialNumber: string;
  period: BillingPeriod;
}

/**
 * Raises a draft invoice for every elapsed, undrafted retainer period.
 *
 * Drafts, never issued invoices: nothing posts to the ledger and nothing goes to
 * a client until a person opens it and sends it. Failures are per-client — one
 * misconfigured retainer must not stop the rest from being drafted.
 */
export async function generateDueDrafts(today = todayIsoDate()): Promise<GeneratedDraft[]> {
  const clients = await db.clients.filter((client) => !client.archived).toArray();
  const candidates = clients.filter((client) => pendingPeriods(client.billing, today).length > 0);
  if (candidates.length === 0) return [];

  const profile = await getEntityProfile();
  const generated: GeneratedDraft[] = [];
  const termsDays = profile.defaultPaymentTermsDays ?? 30;

  for (const client of candidates) {
    for (const period of pendingPeriods(client.billing, today)) {
      // Dated the day after the period closed: the work is complete, and dating
      // it inside the period would freeze an FX rate from before the retainer
      // had been earned.
      const invoiceDate = addDays(period.end, 1);
      try {
        const invoice = await createInvoice(
          {
            clientId: client.id,
            currency: client.defaultCurrency,
            lineItems: [
              {
                id: newId(),
                description: `Retainer — ${period.start} to ${period.end}`,
                quantity: 1,
                unitPrice: client.billing.fixedAmount ?? 0,
                unit: "flat",
              },
            ],
            invoiceDate,
            dueDate: addDays(invoiceDate, termsDays),
            // A draft carries no FX rate yet. Inventing one would freeze a made-up
            // rate into the record the forex realization is computed from, so it
            // stays zero and the invoice form makes the user enter a real one
            // before the draft can be issued.
            invoiceDateFxRate: 0,
            status: "draft",
            billingModel: "fixed",
            periodStart: period.start,
            periodEnd: period.end,
            autoGenerated: true,
          },
          profile
        );

        await db.clients.update(client.id, {
          "billing.lastDraftedPeriodStart": period.start,
          updatedAt: nowIso(),
        });

        await recordAudit({
          actionType: "invoice_auto_drafted",
          entityType: "invoice",
          entityId: invoice.id,
          summary: `${invoice.serialNumber} drafted for ${client.name} — retainer ${period.start} to ${period.end}`,
          after: { periodStart: period.start, periodEnd: period.end },
        });

        generated.push({
          clientId: client.id,
          clientName: client.name,
          serialNumber: invoice.serialNumber,
          period,
        });
      } catch {
        // One client's broken retainer setup must not block the others. The
        // period stays undrafted, so it is retried next time the app opens.
        break;
      }
    }
  }

  return generated;
}

/** True if this client is set up to have drafts raised for it. */
export function isRecurring(client: Pick<Client, "billing">): boolean {
  return client.billing.model === "fixed" && client.billing.autoDraft;
}
