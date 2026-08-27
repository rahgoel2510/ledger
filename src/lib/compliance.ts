import type { CurrencyCode, EntityProfile, Invoice } from "@/lib/types";
import { BASE_CURRENCY_CODE } from "@/lib/currencies";
import { invoiceTotalFcy, type TaxableInvoice } from "@/lib/money";

/**
 * The statutory particulars an invoice from this entity has to carry, in one
 * place, for the two jurisdictions it is read in.
 *
 * **India — Rule 46, CGST Rules 2017.** The supplier is an Indian entity, so the
 * document is an Indian tax invoice whoever it is addressed to. Rule 46 lists the
 * particulars: supplier name/address/GSTIN, a serial number unique within the
 * financial year, the date, the recipient's particulars, HSN or the accounting
 * code of the service, taxable value, rate and amount of tax, the place of supply
 * with the name of the State, the address of delivery where it differs, whether
 * tax is payable on reverse charge, and a signature. On an export it additionally
 * requires the address of delivery, the name of the country of destination, and
 * the LUT endorsement (see `igst.ts` for the endorsement itself).
 *
 * **United States — no federal invoice mandate.** Nothing here is a US filing
 * requirement; what a US payables desk needs is the ability to book the invoice
 * and pay it without withholding. That means the purchase-order reference it was
 * raised against, the currency named explicitly, and two statements of fact about
 * the supplier: that the services were performed outside the United States (so
 * the income is foreign-source and outside Chapter 3 withholding) and that no US
 * sales or use tax has been charged by a non-US supplier with no nexus.
 *
 * Every statement below is a statement of fact about *this* entity's supplies.
 * None of them computes a liability — CLAUDE.md's boundary holds here: the app
 * states what happened and leaves the assessment to the CA.
 */

/** Rule 46(b): a serial is at most 16 characters, alphanumerics with "-" and "/" only. */
export const MAX_SERIAL_LENGTH = 16;
const SERIAL_CHARSET = /^[A-Za-z0-9/-]+$/;

/**
 * Rule 46(p) — every invoice states whether tax is payable on reverse charge.
 * Silence is not compliance: the recipient's own return depends on the answer.
 */
export const REVERSE_CHARGE_YES = "Tax payable on reverse charge basis: YES";
export const REVERSE_CHARGE_NO = "Tax payable on reverse charge basis: NO";

/**
 * For a US recipient. Services performed outside the United States by a non-US
 * person are foreign-source under IRC s.861(a)(3) and outside Chapter 3
 * withholding — the payer's file needs that stated on the invoice, together with
 * the W-8BEN-E it rests on.
 */
export const US_SOURCE_STATEMENT =
  "Services were performed entirely outside the United States by a non-US person. The income is not US-source under IRC s.861(a)(3) and is not subject to US federal withholding.";

export const US_SALES_TAX_STATEMENT =
  "No US sales, use, or excise tax has been charged: the supplier is a non-US entity with no US business nexus.";

/** Rule 46(q). A printed invoice is signed; an electronic one is signed digitally. */
export const SIGNATURE_CAPTION = "Authorised Signatory";

export function isUnitedStates(country: string | undefined): boolean {
  const c = (country ?? "").trim().toLowerCase().replace(/\./g, "");
  return c === "usa" || c === "us" || c === "united states" || c === "united states of america";
}

/** Problems with a serial *structure*, phrased for the settings form. */
export function serialFormatIssues(serial: string): string[] {
  const issues: string[] = [];
  const trimmed = serial.trim();
  if (!trimmed) return issues;
  if (trimmed.length > MAX_SERIAL_LENGTH) {
    issues.push(
      `${trimmed.length} characters long — Rule 46(b) allows at most ${MAX_SERIAL_LENGTH}. Shorten the prefix or the padding.`
    );
  }
  if (!SERIAL_CHARSET.test(trimmed)) {
    issues.push('Only letters, digits, "-" and "/" are permitted in a serial number.');
  }
  return issues;
}

type CompliancePart = Pick<
  Invoice,
  "serialNumber" | "placeOfSupply" | "sacCode" | "clientSnapshot" | "poNumber"
>;

/**
 * Particulars still missing from an invoice, by jurisdiction. Advisory rather
 * than blocking: most of these can only be judged once the invoice exists, and a
 * document that cannot be produced at all is worse than one carrying a gap the
 * user can see and close.
 */
export function invoiceComplianceGaps(
  invoice: CompliancePart,
  profile: EntityProfile
): { india: string[]; unitedStates: string[] } {
  const isExport = invoice.placeOfSupply !== "domestic";
  const india: string[] = [];
  const unitedStates: string[] = [];

  india.push(...serialFormatIssues(invoice.serialNumber).map((issue) => `Serial number is ${issue}`));
  if (!profile.gstin.trim()) india.push("Supplier GSTIN — Rule 46(a).");
  if (!invoice.sacCode?.trim()) {
    india.push("SAC code for the service — Rule 46(g) covers exports too, not only domestic supplies.");
  }
  if (!profile.authorisedSignatory?.trim()) {
    india.push("Authorised signatory — Rule 46(q) requires the invoice to be signed.");
  }
  if (isExport) {
    if (!profile.lutNumber.trim()) india.push("LUT reference — the zero-rating rests on it.");
    if (!invoice.clientSnapshot.country.trim()) {
      india.push("Country of destination — required on an export invoice.");
    }
    if (
      !invoice.clientSnapshot.deliveryAddress?.trim() &&
      !invoice.clientSnapshot.billingAddress?.trim()
    ) {
      india.push("Address of delivery — required on an export invoice.");
    }
  } else {
    if (!profile.state?.trim()) india.push("Supplier's State — the place of supply is stated against it.");
    if (!invoice.clientSnapshot.state?.trim()) india.push("Recipient's State — Rule 46(n).");
    if (!invoice.clientSnapshot.gstin?.trim()) {
      india.push("Recipient GSTIN — required where the recipient is registered.");
    }
  }

  if (isUnitedStates(invoice.clientSnapshot.country)) {
    if (!invoice.poNumber?.trim()) {
      unitedStates.push(
        "Purchase order / reference number — most US payables desks will not process an invoice without one."
      );
    }
    if (!profile.usTaxFormReference?.trim()) {
      unitedStates.push("W-8BEN-E reference — without it the payer may withhold 30% under Chapter 3.");
    }
  }

  return { india, unitedStates };
}

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(value: number): string {
  if (value < 20) return ONES[value];
  if (value < 100) {
    const rest = value % 10;
    return TENS[Math.floor(value / 10)] + (rest ? ` ${ONES[rest]}` : "");
  }
  const rest = value % 100;
  return `${ONES[Math.floor(value / 100)]} Hundred${rest ? ` ${underThousand(rest)}` : ""}`;
}

/** Indian grouping — thousand, lakh, crore. What an Indian auditor reads. */
function indianWords(value: number): string {
  if (value === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1_000);
  const rest = value % 1_000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(" ");
}

/** International grouping — thousand, million, billion. What a US payables desk reads. */
function westernWords(value: number): string {
  if (value === 0) return "Zero";
  const parts: string[] = [];
  const billion = Math.floor(value / 1_000_000_000);
  const million = Math.floor((value % 1_000_000_000) / 1_000_000);
  const thousand = Math.floor((value % 1_000_000) / 1_000);
  const rest = value % 1_000;
  if (billion) parts.push(`${underThousand(billion)} Billion`);
  if (million) parts.push(`${underThousand(million)} Million`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(" ");
}

/** Major/minor unit names for the seeded currencies; anything else falls back to its code. */
const UNIT_NAMES: Record<string, { major: string; minor: string }> = {
  INR: { major: "Rupees", minor: "Paise" },
  USD: { major: "US Dollars", minor: "Cents" },
  EUR: { major: "Euros", minor: "Cents" },
  GBP: { major: "Pounds Sterling", minor: "Pence" },
  SGD: { major: "Singapore Dollars", minor: "Cents" },
  AED: { major: "UAE Dirhams", minor: "Fils" },
};

/**
 * The total spelled out. Indian invoices carry it as a matter of course — it is
 * the check against a tampered figure — and it costs a US reader nothing.
 */
export function amountInWords(amount: number, currency: CurrencyCode = BASE_CURRENCY_CODE): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const whole = Math.floor(absolute);
  const minor = Math.round((absolute - whole) * 100);
  const names = UNIT_NAMES[currency];
  const spell = currency === BASE_CURRENCY_CODE ? indianWords : westernWords;

  const major = names ? `${names.major} ${spell(whole)}` : `${currency} ${spell(whole)}`;
  const fraction = minor
    ? ` and ${names ? `${names.minor} ${spell(minor)}` : `${spell(minor)}/100`}`
    : "";
  return `${negative ? "Minus " : ""}${major}${fraction} Only`;
}

/** The invoice total, spelled out — for the PDF and the detail sheet. */
export function invoiceTotalInWords(invoice: TaxableInvoice & Pick<Invoice, "currency">): string {
  return amountInWords(invoiceTotalFcy(invoice), invoice.currency);
}

/**
 * Two invoices sharing a serial number — the one gap multi-device sync can
 * open (module: multi-device sync). `serial.ts`'s counter is local-transaction
 * safe, but two devices offline at once can each allocate what they believe is
 * the next number before either has seen the other's invoice. This is
 * advisory, not blocking, same as every other compliance check here: the fix
 * is a manual renumber once the collision is visible, not refusing the save
 * that could not have known about it.
 */
export function duplicateSerialWarnings(
  invoices: Pick<Invoice, "id" | "serialNumber">[]
): { serialNumber: string; invoiceIds: string[] }[] {
  const byserial = new Map<string, string[]>();
  for (const invoice of invoices) {
    const ids = byserial.get(invoice.serialNumber);
    if (ids) ids.push(invoice.id);
    else byserial.set(invoice.serialNumber, [invoice.id]);
  }
  return Array.from(byserial.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([serialNumber, invoiceIds]) => ({ serialNumber, invoiceIds }));
}
