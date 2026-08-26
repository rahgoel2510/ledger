/**
 * Shared domain types for VrikshaFX.
 *
 * Record-keeping compliance only — nothing here computes tax liability.
 * See CLAUDE.md "Tax scope boundary" before adding fields that would.
 */

export type CurrencyCode = string; // ISO 4217, e.g. "INR", "USD", "EUR" — user-extensible, see lib/currencies.ts

export interface Currency {
  code: CurrencyCode;
  name: string;
  symbol: string;
  /** True for the entity's reporting currency (INR). Exactly one currency should have this set. */
  isBase: boolean;
  /** False for currencies the user has removed from active use; kept so historical invoices still resolve. */
  active: boolean;
}

/**
 * The HUF's own particulars. Singleton row (id === ENTITY_PROFILE_ID) — every
 * invoice PDF is legally required to carry the bank wire block and the entity's
 * GSTIN/LUT, so this must be filled before an invoice can be issued.
 */
export interface EntityProfile {
  id: "default";

  legalName: string;
  /** Free-form, newline-separated postal address as it should appear on the invoice. */
  address: string;
  email: string;
  phone: string;

  pan: string;
  gstin: string;
  /** Letter of Undertaking reference — printed on the invoice alongside the IGST disclaimer. */
  lutNumber: string;

  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankSwift: string;
  bankBranch: string;

  /** Serial-number structure: `{prefix}/{FY}/{seq padded to serialPadding}`. */
  invoiceSerialPrefix: string;
  invoiceSerialPadding: number;
  /** Default gap between invoice date and due date when creating an invoice. */
  defaultPaymentTermsDays: number;

  updatedAt: string; // ISO 8601
}

export const ENTITY_PROFILE_ID = "default" as const;

/**
 * Monotonic counters, e.g. the per-financial-year invoice sequence. Kept in
 * their own table rather than derived from `max(sequence)` so a deleted or
 * voided invoice never frees its number for reuse (module 1, US-1).
 */
export interface Counter {
  key: string; // e.g. "invoice-seq:26-27"
  value: number;
}

/** Status as displayed. "overdue" is derived at read time, never stored — see StoredInvoiceStatus. */
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

/**
 * Status as persisted. Overdue is a function of (dueDate, outstanding amount)
 * and would go stale the moment it was written down, so it is computed on read
 * by `deriveInvoiceStatus` (module 1, US-3).
 */
export type StoredInvoiceStatus = Exclude<InvoiceStatus, "overdue">;

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * A client's billing details as they existed at the time an invoice was created.
 * Invoices store a snapshot (see Invoice.clientSnapshot) so later edits to the
 * Client record never retroactively alter an issued invoice.
 */
export interface ClientSnapshot {
  name: string;
  country: string;
  billingAddress?: string;
  taxId?: string;
  primaryContact?: string;
  defaultCurrency: CurrencyCode;
}

export interface Client extends ClientSnapshot {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Soft-delete flag — clients referenced by existing invoices are never hard-deleted. */
  archived: boolean;
}

export interface Invoice {
  id: string;
  /** {prefix}/{FY}/{seq} — see CLAUDE.md domain rules. Sequence is never reused. */
  serialNumber: string;
  financialYear: string; // e.g. "26-27"
  sequence: number;

  clientId: string;
  clientSnapshot: ClientSnapshot;

  currency: CurrencyCode;
  lineItems: InvoiceLineItem[];

  invoiceDate: string; // ISO 8601 date
  dueDate: string; // ISO 8601 date

  /**
   * FX rate (1 unit of `currency` -> INR) captured at invoice creation.
   * Frozen permanently — reused by the forex realization formula in module 3,
   * never recomputed or replaced by a later/live rate. See CLAUDE.md.
   */
  invoiceDateFxRate: number;

  status: StoredInvoiceStatus;
  /** True if status was set to "paid" by a human action rather than derived from remittances (module 3, US-4). */
  manualStatusOverride: boolean;

  /** Optional free-text shown under the line items on the PDF. */
  notes?: string;

  igstDisclaimerShown: true; // always true — every PDF carries the LUT/IGST disclaimer verbatim

  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Remittance {
  id: string;
  invoiceId: string;

  receiptDate: string; // ISO 8601 date
  receiptTime: string; // HH:mm

  fcyReceived: number;
  inrCredited: number;
  bankCharges: number; // INR

  /** Foreign Inward Remittance Certificate reference — mandatory, not optional metadata. */
  fircReference: string;

  /**
   * Realized Forex Gain/Loss = INR Credited - (FCY Received x Invoice Date FX Rate) - Bank Charges.
   * Computed at entry time from the linked invoice's frozen invoiceDateFxRate. Stored, not derived live.
   */
  realizedForexGainLoss: number;

  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export type ExpenseCategoryId = string;

export interface ExpenseCategory {
  id: ExpenseCategoryId;
  name: string;
  /** Ledger account expense entries in this category post to. */
  ledgerAccount: LedgerAccount;
  /** Deactivated categories are hidden from new-entry pickers but retained on historical expenses. */
  active: boolean;
}

export interface ExpenseEntry {
  id: string;
  date: string; // ISO 8601 date
  categoryId: ExpenseCategoryId;
  amountInr: number;
  description: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Double-entry ledger posting. Immutable once written — corrections are reversing entries, not edits. */
export type LedgerAccount =
  | "accounts_receivable"
  | "foreign_income"
  | "bank"
  | "forex_gain_loss"
  | "bank_charges_expense"
  | "software_expense"
  | "filing_fees_expense"
  | "other_expense";

export type LedgerSourceType = "invoice" | "remittance" | "expense" | "reversal";

export interface LedgerEntry {
  id: string;
  date: string; // ISO 8601
  account: LedgerAccount;
  debit: number; // INR, 0 if this line is a credit
  credit: number; // INR, 0 if this line is a debit
  sourceType: LedgerSourceType;
  sourceId: string; // Invoice/Remittance/ExpenseEntry id (or the entry id being reversed)
  memo?: string;
  createdAt: string; // ISO 8601
}

export type AuditActionType =
  | "invoice_created"
  | "invoice_updated"
  | "invoice_deleted"
  | "invoice_status_changed"
  | "invoice_status_overridden"
  | "remittance_recorded"
  | "invoice_pdf_downloaded"
  | "client_created"
  | "client_updated"
  | "client_archived"
  | "expense_recorded"
  | "entity_profile_updated"
  | "currency_settings_changed"
  | "data_imported";

export type AuditEntityType =
  | "invoice"
  | "remittance"
  | "client"
  | "expense"
  | "settings";

export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId: string;
  /** True for actions a human explicitly forced rather than the system derived (module 8, US-2). */
  isManualOverride: boolean;
  /** Human-readable one-line summary, so the audit view never has to diff `before`/`after` to be useful. */
  summary: string;
  before?: unknown;
  after?: unknown;
}
