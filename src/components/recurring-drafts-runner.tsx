"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { generateDueDrafts } from "@/lib/recurring";

/**
 * Raises retainer drafts for periods that have elapsed since the app was last
 * opened.
 *
 * Mounted once in the root layout, and gated on a module-level flag rather than
 * a ref: React runs effects twice in development, and two concurrent passes over
 * the same client would each read `lastDraftedPeriodStart` before either wrote
 * it — which is exactly how a period gets billed twice.
 *
 * Every draft it raises consumes an invoice serial permanently (see the header
 * of lib/recurring.ts). That is why the toast names each one: a number quietly
 * taken and later deleted becomes a gap the user has to explain, so they are
 * told the moment it happens rather than discovering it at filing time.
 */

let started = false;

export function RecurringDraftsRunner() {
  useEffect(() => {
    if (started) return;
    started = true;

    generateDueDrafts()
      .then((drafts) => {
        if (drafts.length === 0) return;
        toast.success(
          drafts.length === 1
            ? `Drafted ${drafts[0].serialNumber} for ${drafts[0].clientName}`
            : `Drafted ${drafts.length} retainer invoices`,
          {
            description: drafts
              .map((draft) => `${draft.serialNumber} — ${draft.clientName} (${draft.period.start} to ${draft.period.end})`)
              .join("\n"),
            duration: 12000,
          }
        );
      })
      .catch((error) => {
        // Never blocks the app: the periods stay undrafted and are retried next
        // time it opens.
        console.error("Recurring draft generation failed:", error);
      });
  }, []);

  return null;
}
