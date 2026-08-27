import type { CurrencyCode, Invoice, InvoiceLineItem, InvoiceTask } from "@/lib/types";
import { BASE_CURRENCY_CODE } from "@/lib/currencies";

/**
 * Money is held as plain numbers (JS doubles). Amounts here are invoice-scale,
 * well inside the 2^53 integer-cent range, but every persisted total goes
 * through `round2` so repeated arithmetic can't accumulate binary drift.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Hours logged against a line's itemised tasks. Zero when it has none. */
export function taskHours(tasks: InvoiceTask[] | undefined): number {
  return round2((tasks ?? []).reduce((sum, task) => sum + task.hours, 0));
}

/**
 * The quantity a line is actually billed on.
 *
 * A line with an itemised breakdown is billed on the sum of its tasks, not on
 * the number stored beside it: the annexure and the invoice face are the same
 * document, so a total that disagreed with the rows printed under it would be an
 * arithmetic error a client can see. `quantity` is kept in step as a convenience
 * for the list views; this is the figure every total is built from.
 */
export function lineItemQuantity(item: InvoiceLineItem): number {
  if (item.tasks?.length) return taskHours(item.tasks);
  return item.quantity;
}

export function lineItemAmount(item: InvoiceLineItem): number {
  return round2(lineItemQuantity(item) * item.unitPrice);
}

/** Lines carrying an itemised breakdown, in invoice order — the annexure's sections. */
export function annexureLines(invoice: Pick<Invoice, "lineItems">): InvoiceLineItem[] {
  return invoice.lineItems.filter((item) => (item.tasks?.length ?? 0) > 0);
}

export function hasAnnexure(invoice: Pick<Invoice, "lineItems">): boolean {
  return annexureLines(invoice).length > 0;
}

/**
 * Every hour on the invoice, whether logged as a bare hourly line or itemised
 * into tasks. Flat retainer lines contribute nothing — their quantity is a
 * count of periods, not time.
 */
export function invoiceTotalHours(invoice: Pick<Invoice, "lineItems">): number {
  return round2(
    invoice.lineItems
      .filter((item) => item.unit === "hours")
      .reduce((sum, item) => sum + lineItemQuantity(item), 0)
  );
}

/**
 * Enough of an invoice to total it up. `gstRate` is optional so a half-built
 * form object still totals; absent means 0%, which is what an export invoice
 * carries anyway (zero-rated under LUT — see CLAUDE.md).
 */
export type TaxableInvoice = Pick<Invoice, "lineItems"> & { gstRate?: number };

/** Line items only, before tax. */
export function invoiceSubtotalFcy(invoice: TaxableInvoice): number {
  return round2(invoice.lineItems.reduce((sum, item) => sum + lineItemAmount(item), 0));
}

/** GST charged, at the rate the user stated. Always 0 on an export invoice. */
export function invoiceTaxFcy(invoice: TaxableInvoice): number {
  const rate = invoice.gstRate ?? 0;
  if (!rate) return 0;
  return round2((invoiceSubtotalFcy(invoice) * rate) / 100);
}

/**
 * What the client actually owes — subtotal plus GST. This is the figure the
 * receivable, the remittance matching, and the PDF's Total all use, so an
 * invoice is only settled once the tax has been received too.
 */
export function invoiceTotalFcy(invoice: TaxableInvoice): number {
  return round2(invoiceSubtotalFcy(invoice) + invoiceTaxFcy(invoice));
}

/**
 * Splits GST into the halves a CGST/SGST invoice prints. Arithmetic on the
 * stated rate — it is not a determination of whether the supply is intra-state.
 */
export function gstHalves(amount: number): { half: number; rest: number } {
  const half = round2(amount / 2);
  return { half, rest: round2(amount - half) };
}

/** Invoice amounts translated at the frozen invoice-date FX rate. Never re-fetch the rate. */
export function invoiceSubtotalInr(invoice: TaxableInvoice & Pick<Invoice, "invoiceDateFxRate">): number {
  return round2(invoiceSubtotalFcy(invoice) * invoice.invoiceDateFxRate);
}

export function invoiceTaxInr(invoice: TaxableInvoice & Pick<Invoice, "invoiceDateFxRate">): number {
  return round2(invoiceTaxFcy(invoice) * invoice.invoiceDateFxRate);
}

export function invoiceTotalInr(invoice: TaxableInvoice & Pick<Invoice, "invoiceDateFxRate">): number {
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
