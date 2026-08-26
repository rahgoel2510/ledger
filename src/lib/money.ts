import type { CurrencyCode, Invoice, InvoiceLineItem } from "@/lib/types";
import { BASE_CURRENCY_CODE } from "@/lib/currencies";

/**
 * Money is held as plain numbers (JS doubles). Amounts here are invoice-scale,
 * well inside the 2^53 integer-cent range, but every persisted total goes
 * through `round2` so repeated arithmetic can't accumulate binary drift.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function lineItemAmount(item: InvoiceLineItem): number {
  return round2(item.quantity * item.unitPrice);
}

/** Invoice total in its own (foreign) currency. IGST is always 0% — see CLAUDE.md. */
export function invoiceTotalFcy(invoice: Pick<Invoice, "lineItems">): number {
  return round2(invoice.lineItems.reduce((sum, item) => sum + lineItemAmount(item), 0));
}

/** Invoice total translated at the frozen invoice-date FX rate. Never re-fetch the rate. */
export function invoiceTotalInr(invoice: Pick<Invoice, "lineItems" | "invoiceDateFxRate">): number {
  return round2(invoiceTotalFcy(invoice) * invoice.invoiceDateFxRate);
}

/**
 * Currency-aware amount formatting. INR uses the Indian digit grouping
 * (1,00,000) that a CA expects to see; everything else uses standard grouping.
 */
export function formatMoney(amount: number, currency: CurrencyCode = BASE_CURRENCY_CODE): string {
  const locale = currency === BASE_CURRENCY_CODE ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Non-ISO codes a user added by hand fall back to a plain prefixed number.
    return `${currency} ${formatNumber(amount)}`;
  }
}

/** Amount with grouping but no currency symbol — for table columns that carry the code in the header. */
export function formatNumber(amount: number, locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Signed display for gain/loss figures, so a loss is never mistaken for a gain. */
export function formatSignedMoney(amount: number, currency: CurrencyCode = BASE_CURRENCY_CODE): string {
  const formatted = formatMoney(Math.abs(amount), currency);
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

/** FX rates carry more precision than money — 4 decimals matches bank advice slips. */
export function formatFxRate(rate: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(rate);
}
