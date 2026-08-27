import { db } from "@/lib/db";
import { ENTITY_PROFILE_ID, type EntityProfile } from "@/lib/types";
import { nowIso } from "@/lib/ids";

/**
 * The text a particular carries until the real one is known.
 *
 * It is deliberately not a plausible-looking value. A prefilled GSTIN or account
 * number that reads as real is the one failure mode worth engineering against
 * here: it would print on an export invoice, be paid against, and nothing in the
 * document would say it was a guess. "TO BE UPDATED" printed in a supplier block
 * is unmistakably unfinished, which is the honest state of the record.
 */
export const PROFILE_PLACEHOLDER = "TO BE UPDATED";

/**
 * Seeded on first run, and used to fill blanks on an existing install (db v4).
 *
 * Prefilled rather than blank so the app is usable end to end from the first
 * launch — every screen renders, every PDF generates, and the particulars are
 * corrected in Settings as they become known. Blanks remain entirely legal: a
 * field cleared by hand stays cleared, and nothing refuses to save or to
 * generate because of it.
 */
export const STARTER_ENTITY_PROFILE: EntityProfile = {
  id: ENTITY_PROFILE_ID,
  legalName: "Rahul Goel HUF",
  address: PROFILE_PLACEHOLDER,
  email: "",
  phone: "",
  pan: "",
  gstin: PROFILE_PLACEHOLDER,
  lutNumber: "",
  bankName: PROFILE_PLACEHOLDER,
  bankAccountNumber: PROFILE_PLACEHOLDER,
  bankIfsc: PROFILE_PLACEHOLDER,
  bankSwift: PROFILE_PLACEHOLDER,
  bankBranch: "",
  state: "",
  stateCode: "",
  authorisedSignatory: "Rahul Goel",
  usTaxFormReference: "",
  invoiceSerialPrefix: "RGHUF",
  invoiceSerialPadding: 3,
  defaultPaymentTermsDays: 30,
  updatedAt: nowIso(),
};

/**
 * Particulars a compliant invoice needs: the bank wire block and GSTIN
 * (CLAUDE.md), plus the signatory Rule 46(q) requires.
 *
 * This list is advisory, not a gate. Nothing in the app refuses to save or to
 * generate a PDF because an entry here is unfilled — it drives the reminder that
 * says which particulars a document is still going out without. Blocking was
 * tried and removed: the profile is filled in over weeks, and a blocked PDF
 * during those weeks is a worse outcome than a specimen one clearly marked as
 * incomplete.
 *
 * Only what is mandatory on every invoice belongs here. Particulars that depend
 * on the supply — the supplier's State on a domestic invoice, the W-8BEN-E
 * reference on a US one — are reported per invoice by `invoiceComplianceGaps`
 * instead, since flagging every invoice on them would flag the ones they say
 * nothing about.
 */
export const REQUIRED_PROFILE_FIELDS = [
  ["legalName", "Legal name"],
  ["address", "Address"],
  ["gstin", "GSTIN"],
  ["authorisedSignatory", "Authorised signatory"],
  ["bankName", "Bank name"],
  ["bankAccountNumber", "Bank account number"],
  ["bankIfsc", "IFSC code"],
  ["bankSwift", "SWIFT/BIC code"],
] as const satisfies ReadonlyArray<readonly [keyof EntityProfile, string]>;

/** True for a particular still carrying the seeded placeholder rather than a real value. */
export function isPlaceholderValue(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase() === PROFILE_PLACEHOLDER;
}

/**
 * True for a particular nobody has actually confirmed — blank, or still the
 * seeded placeholder. The two are the same thing to anything that decides
 * whether it may fill a field in: a placeholder is not somebody's phone call to
 * their bank, so the IFSC lookup is free to overwrite it.
 */
export function isUnconfirmedValue(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return text === "" || text.toUpperCase() === PROFILE_PLACEHOLDER;
}

/** Human-readable labels for particulars left blank outright. */
export function missingProfileFields(profile: EntityProfile | undefined): string[] {
  if (!profile) return REQUIRED_PROFILE_FIELDS.map(([, label]) => label);
  return REQUIRED_PROFILE_FIELDS.filter(([key]) => !String(profile[key] ?? "").trim()).map(
    ([, label]) => label
  );
}

/** Human-readable labels for particulars still holding the seeded placeholder. */
export function placeholderProfileFields(profile: EntityProfile | undefined): string[] {
  if (!profile) return [];
  return REQUIRED_PROFILE_FIELDS.filter(([key]) => isPlaceholderValue(profile[key])).map(
    ([, label]) => label
  );
}

/**
 * Everything a document would go out without or with a placeholder in — what the
 * reminder lists. Blank and placeholder are reported together because they read
 * the same way to whoever receives the invoice.
 */
export function unconfirmedProfileFields(profile: EntityProfile | undefined): string[] {
  return [...missingProfileFields(profile), ...placeholderProfileFields(profile)];
}

export function isProfileComplete(profile: EntityProfile | undefined): boolean {
  return unconfirmedProfileFields(profile).length === 0;
}

export async function getEntityProfile(): Promise<EntityProfile> {
  return (await db.entityProfile.get(ENTITY_PROFILE_ID)) ?? STARTER_ENTITY_PROFILE;
}
