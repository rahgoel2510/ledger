import type { Transaction } from "dexie";
import { db } from "@/lib/db";
import type {
  ExpenseEntry,
  Invoice,
  LedgerAccount,
  LedgerEntry,
  LedgerSourceType,
  Remittance,
} from "@/lib/types";
import { newId, nowIso } from "@/lib/ids";
import { invoiceSubtotalInr, invoiceTaxInr, invoiceTotalFcy, invoiceTotalInr, round2 } from "@/lib/money";
import { bookedInrValue, pureForexVariance } from "@/lib/forex";
import { enqueueSync } from "@/lib/sync";

/**
 * Double-entry posting engine (module 4, US-1 & US-4).
 *
 * POSTING RULES — the whole of the ledger's behaviour, written down here rather
 * than scattered across the pages that trigger it. Every amount is INR.
 *
 *   Invoice issued (Draft -> Sent):
 *     Dr accounts_receivable   total (incl. GST) FCY x invoice-date FX rate
 *       Cr foreign_income / domestic_income   net of GST
 *       Cr gst_payable         GST charged, if any
 *   On an export invoice GST is zero, the gst_payable line is dropped as empty,
 *   and this is the same two-line posting it has always been. GST collected on a
 *   domestic invoice is a liability, never income — crediting it to income would
 *   overstate the P&L by the tax.
 *   Nothing posts while an invoice is still a Draft — a draft is not yet a
 *   receivable and must not show up in income.
 *
 *   Remittance received:
 *     Dr bank                  INR credited - bank charges   (cash that actually landed)
 *     Dr bank_charges_expense  bank charges
 *       Cr accounts_receivable FCY received x invoice-date FX rate  (relieve at booked rate)
 *       Cr forex_gain_loss     INR credited - (FCY received x rate)  (plug; may be a debit)
 *   The two P&L lines (bank_charges_expense and forex_gain_loss) net to exactly
 *   the `realizedForexGainLoss` stored on the remittance, but stay separate so
 *   the CA sees bank charges as their own expense line.
 *
 *   Expense recorded:
 *     Dr <category's expense account>  amount
 *       Cr bank                        amount
 *
 * Entries are append-only. A correction is a reversing set of entries
 * (sourceType "reversal"), never an edit or delete of the original.
 */

interface PostingLine {
  account: LedgerAccount;
  debit: number;
  credit: number;
  memo?: string;
}

/** Throws rather than writing a set of lines that doesn't balance — an unbalanced ledger is worse than a failed save. */
function assertBalanced(lines: PostingLine[], context: string): void {
  const debits = round2(lines.reduce((sum, l) => sum + l.debit, 0));
  const credits = round2(lines.reduce((sum, l) => sum + l.credit, 0));
  if (Math.abs(debits - credits) > 0.01) {
    throw new Error(
      `Refusing to post unbalanced ledger entry for ${context}: debits ${debits} != credits ${credits}`
    );
  }
}

function buildEntries(
  lines: PostingLine[],
  meta: { date: string; sourceType: LedgerSourceType; sourceId: string }
): LedgerEntry[] {
  const createdAt = nowIso();
  return lines
    .filter((line) => line.debit !== 0 || line.credit !== 0)
    .map((line) => ({
      id: newId(),
      date: meta.date,
      account: line.account,
      debit: round2(line.debit),
      credit: round2(line.credit),
      sourceType: meta.sourceType,
      sourceId: meta.sourceId,
      memo: line.memo,
      createdAt,
    }));
}

/** Ledger lines for an invoice being issued. Pure — see `postInvoiceIssued` to persist. */
export function invoicePostingLines(invoice: Invoice): PostingLine[] {
  const total = invoiceTotalInr(invoice);
  const income = invoiceSubtotalInr(invoice);
  const tax = invoiceTaxInr(invoice);
  const incomeAccount: LedgerAccount =
    invoice.placeOfSupply === "domestic" ? "domestic_income" : "foreign_income";
  const memo = `${invoice.serialNumber} — ${invoice.clientSnapshot.name} (${invoice.currency} ${invoiceTotalFcy(invoice)})`;
  return [
    { account: "accounts_receivable", debit: total, credit: 0, memo },
    { account: incomeAccount, debit: 0, credit: income, memo },
    { account: "gst_payable", debit: 0, credit: tax, memo },
  ];
}

/** Ledger lines for a remittance. `invoice` supplies the frozen invoice-date FX rate. */
export function remittancePostingLines(
  remittance: Remittance,
  invoice: Pick<Invoice, "serialNumber" | "currency" | "invoiceDateFxRate">
): PostingLine[] {
  const relieved = bookedInrValue(remittance.fcyReceived, invoice.invoiceDateFxRate);
  const variance = pureForexVariance({
    inrCredited: remittance.inrCredited,
    fcyReceived: remittance.fcyReceived,
    invoiceDateFxRate: invoice.invoiceDateFxRate,
  });
  const memo = `${invoice.serialNumber} — FIRC ${remittance.fircReference}`;

  return [
    { account: "bank", debit: round2(remittance.inrCredited - remittance.bankCharges), credit: 0, memo },
    { account: "bank_charges_expense", debit: remittance.bankCharges, credit: 0, memo },
    { account: "accounts_receivable", debit: 0, credit: relieved, memo },
    // A negative variance is a loss: flip it to the debit side rather than posting a negative credit.
    {
      account: "forex_gain_loss",
      debit: variance < 0 ? -variance : 0,
      credit: variance > 0 ? variance : 0,
      memo,
    },
  ];
}

export function expensePostingLines(
  expense: ExpenseEntry,
  account: LedgerAccount
): PostingLine[] {
  const memo = expense.description;
  return [
    { account, debit: expense.amountInr, credit: 0, memo },
    { account: "bank", debit: 0, credit: expense.amountInr, memo },
  ];
}

async function write(
  tx: Transaction | null,
  lines: PostingLine[],
  meta: { date: string; sourceType: LedgerSourceType; sourceId: string; context: string }
): Promise<void> {
  assertBalanced(lines, meta.context);
  const entries = buildEntries(lines, meta);
  const table = tx ? tx.table<LedgerEntry>("ledgerEntries") : db.ledgerEntries;
  await table.bulkAdd(entries);
  for (const entry of entries) await enqueueSync(tx, "ledgerEntries", entry.id);
}

export async function postInvoiceIssued(invoice: Invoice, tx: Transaction | null = null): Promise<void> {
  await write(tx, invoicePostingLines(invoice), {
    date: invoice.invoiceDate,
    sourceType: "invoice",
    sourceId: invoice.id,
    context: `invoice ${invoice.serialNumber}`,
  });
}

export async function postRemittance(
  remittance: Remittance,
  invoice: Pick<Invoice, "serialNumber" | "currency" | "invoiceDateFxRate">,
  tx: Transaction | null = null
): Promise<void> {
  await write(tx, remittancePostingLines(remittance, invoice), {
    date: remittance.receiptDate,
    sourceType: "remittance",
    sourceId: remittance.id,
    context: `remittance ${remittance.fircReference}`,
  });
}

export async function postExpense(
  expense: ExpenseEntry,
  account: LedgerAccount,
  tx: Transaction | null = null
): Promise<void> {
  await write(tx, expensePostingLines(expense, account), {
    date: expense.date,
    sourceType: "expense",
    sourceId: expense.id,
    context: `expense ${expense.id}`,
  });
}

/**
 * Appends the mirror image of every entry posted for a source, so the net effect
 * is nil without mutating history. Use when an issued invoice is voided or a
 * remittance was entered against the wrong invoice.
 */
export async function reverseSource(
  sourceType: LedgerSourceType,
  sourceId: string,
  date: string,
  tx: Transaction | null = null
): Promise<void> {
  const table = tx ? tx.table<LedgerEntry>("ledgerEntries") : db.ledgerEntries;
  const original = await table.where("[sourceType+sourceId]").equals([sourceType, sourceId]).toArray();
  if (original.length === 0) return;

  const createdAt = nowIso();
  const reversals = original.map((entry) => ({
    id: newId(),
    date,
    account: entry.account,
    debit: entry.credit,
    credit: entry.debit,
    sourceType: "reversal" as const,
    sourceId: entry.id,
    memo: `Reversal of ${entry.memo ?? entry.id}`,
    createdAt,
  }));
  await table.bulkAdd(reversals);
  for (const entry of reversals) await enqueueSync(tx, "ledgerEntries", entry.id);
}

export async function hasPostingsFor(sourceType: LedgerSourceType, sourceId: string): Promise<boolean> {
  const count = await db.ledgerEntries
    .where("[sourceType+sourceId]")
    .equals([sourceType, sourceId])
    .count();
  return count > 0;
}

export const LEDGER_ACCOUNT_LABELS: Record<LedgerAccount, string> = {
  accounts_receivable: "Accounts Receivable",
  foreign_income: "Foreign Income (Export of Services)",
  domestic_income: "Domestic Service Income",
  gst_payable: "GST Payable",
  bank: "Bank",
  forex_gain_loss: "Realized Forex Gain / (Loss)",
  bank_charges_expense: "Bank Charges",
  software_expense: "Software Subscriptions",
  filing_fees_expense: "Filing Fees",
  other_expense: "Other Expenses",
};
