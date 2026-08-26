import { db } from "@/lib/db";
import { ENTITY_PROFILE_ID, type EntityProfile } from "@/lib/types";
import { nowIso } from "@/lib/ids";

/**
 * A blank profile is seeded on first run so the Settings form always has a row
 * to edit. It is deliberately empty rather than pre-filled with guessed bank
 * details — a wrong account number on an export invoice is worse than a missing one.
 */
export const EMPTY_ENTITY_PROFILE: EntityProfile = {
  id: ENTITY_PROFILE_ID,
  legalName: "Rahul Goel HUF",
  address: "",
  email: "",
  phone: "",
  pan: "",
  gstin: "",
  lutNumber: "",
  bankName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  bankSwift: "",
  bankBranch: "",
  invoiceSerialPrefix: "RGHUF/INV",
  invoiceSerialPadding: 3,
  defaultPaymentTermsDays: 30,
  updatedAt: nowIso(),
};

/**
 * Fields an invoice PDF cannot legally omit (CLAUDE.md: bank wire block + GSTIN).
 * Invoicing is gated on these being present rather than silently rendering blanks.
 */
export const REQUIRED_PROFILE_FIELDS = [
  ["legalName", "Legal name"],
  ["address", "Address"],
  ["gstin", "GSTIN"],
  ["bankName", "Bank name"],
  ["bankAccountNumber", "Bank account number"],
  ["bankIfsc", "IFSC code"],
  ["bankSwift", "SWIFT/BIC code"],
] as const satisfies ReadonlyArray<readonly [keyof EntityProfile, string]>;

/** Human-readable labels for whatever is still missing; empty array means ready to invoice. */
export function missingProfileFields(profile: EntityProfile | undefined): string[] {
  if (!profile) return REQUIRED_PROFILE_FIELDS.map(([, label]) => label);
  return REQUIRED_PROFILE_FIELDS.filter(([key]) => !String(profile[key] ?? "").trim()).map(
    ([, label]) => label
  );
}

export function isProfileComplete(profile: EntityProfile | undefined): boolean {
  return missingProfileFields(profile).length === 0;
}

export async function getEntityProfile(): Promise<EntityProfile> {
  return (await db.entityProfile.get(ENTITY_PROFILE_ID)) ?? EMPTY_ENTITY_PROFILE;
}
