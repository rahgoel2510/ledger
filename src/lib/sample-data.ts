import { db } from "@/lib/db";
import type { EntityProfile } from "@/lib/types";
import { ENTITY_PROFILE_ID } from "@/lib/types";
import { nowIso } from "@/lib/ids";
import { recordAudit } from "@/lib/audit";
import { createClient, type ClientInput } from "@/lib/clients";

/**
 * Plausible particulars for clicking through the app on a fresh database.
 *
 * These are the same values the E2E suite issues invoices against, so a PDF
 * generated off them clears every Rule 46 check and carries the US block. That
 * is the point: the compliance gates stay exactly where they are, and this fills
 * them in rather than lowering them.
 *
 * Nothing here is real. The GSTIN, PAN, account number and IFSC are structurally
 * valid and deliberately fictitious — an invoice produced from them is a
 * specimen, not a document to send anyone.
 */
const SAMPLE_PROFILE: Omit<EntityProfile, "id" | "updatedAt"> = {
  legalName: "Rahul Goel HUF",
  address: "12 Nehru Place\nNew Delhi 110019\nIndia",
  email: "books@example.invalid",
  phone: "+91 98100 00000",
  pan: "AAAAA0000A",
  gstin: "07AAAAA0000A1Z5",
  lutNumber: "AD070422000123X",
  state: "Delhi",
  stateCode: "07",
  authorisedSignatory: "Rahul Goel",
  usTaxFormReference: "W-8BEN-E dated 2026-04-01",
  bankName: "HDFC Bank",
  bankAccountNumber: "50100123456789",
  bankIfsc: "HDFC0000123",
  bankSwift: "HDFCINBB",
  bankBranch: "Nehru Place",
  invoiceSerialPrefix: "RGHUF",
  invoiceSerialPadding: 3,
  defaultPaymentTermsDays: 30,
};

/**
 * One of each kind of supply, because they take different paths through the
 * app: the export is zero-rated under the LUT and carries the US statements,
 * the domestic one carries GST, a SAC code and a place of supply named as a
 * State — and is billed in rupees, so it never asks for an exchange rate.
 */
const SAMPLE_CLIENTS: ClientInput[] = [
  {
    name: "Acme Inc",
    country: "United States",
    billingAddress: "500 Market St\nSan Francisco, CA 94105",
    deliveryAddress: "1 Infinite Loop\nCupertino, CA 95014",
    taxId: "EIN 12-3456789",
    primaryContact: "A. Payables",
    defaultCurrency: "USD",
    placeOfSupply: "export",
    defaultSacCode: "998313",
    billing: { model: "hourly", hourlyRate: 150, autoDraft: false },
  },
  {
    name: "Bharat Systems Pvt Ltd",
    country: "India",
    billingAddress: "42 MG Road\nBengaluru 560001",
    defaultCurrency: "INR",
    placeOfSupply: "domestic",
    gstin: "29AAAAA0000A1Z5",
    state: "Karnataka",
    defaultGstRate: 18,
    defaultTaxTreatment: "igst",
    defaultSacCode: "998313",
    billing: {
      model: "fixed",
      fixedAmount: 50000,
      cycle: { intervalUnit: "month", intervalCount: 1 },
      cycleAnchorDate: "2026-04-01",
      autoDraft: false,
    },
  },
];

export interface SampleDataResult {
  clientsAdded: string[];
  profileFilled: boolean;
}

/**
 * Fills the entity profile and adds the sample clients. Refuses once an invoice
 * exists: past that point the profile is what issued invoices were raised
 * under, and overwriting it with specimen particulars would rewrite the
 * supplier block on every PDF regenerated afterwards.
 *
 * Clients already present by name are left alone, so this can be run twice
 * without collecting duplicates.
 */
export async function loadSampleData(): Promise<SampleDataResult> {
  const invoiceCount = await db.invoices.count();
  if (invoiceCount > 0) {
    throw new Error(
      "There are already invoices in this database. Sample data would overwrite the particulars they were issued under."
    );
  }

  const profile: EntityProfile = {
    ...SAMPLE_PROFILE,
    id: ENTITY_PROFILE_ID,
    updatedAt: nowIso(),
  };
  const before = await db.entityProfile.get(ENTITY_PROFILE_ID);

  await db.transaction("rw", db.entityProfile, db.auditLog, async (tx) => {
    await db.entityProfile.put(profile);
    await recordAudit(
      {
        actionType: "entity_profile_updated",
        entityType: "settings",
        entityId: ENTITY_PROFILE_ID,
        summary: "Entity profile filled with sample data",
        before,
        after: profile,
        // A human asked for particulars the data did not imply. The audit trail
        // is the only place that stays true about where these numbers came from.
        isManualOverride: true,
      },
      tx
    );
  });

  const existing = new Set((await db.clients.toArray()).map((client) => client.name));
  const clientsAdded: string[] = [];
  for (const input of SAMPLE_CLIENTS) {
    if (existing.has(input.name)) continue;
    await createClient(input);
    clientsAdded.push(input.name);
  }

  return { clientsAdded, profileFilled: true };
}
