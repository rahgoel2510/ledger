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

  /**
   * The supplier's own State and its GST state code. Rule 46(n) states the place
   * of supply *against* the supplier's State, so a domestic invoice cannot show
   * where a supply landed without it.
   */
  state?: string;
  stateCode?: string;
  /** Name printed under the signature block — Rule 46(q) requires the invoice to be signed. */
  authorisedSignatory?: string;
  /**
   * How the US withholding certificate on file is referenced, e.g.
   * "W-8BEN-E dated 14 Mar 2026". Quoted on invoices to US clients: without it a
   * US payer may withhold 30% under Chapter 3.
   */
  usTaxFormReference?: string;

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

/**
 * Where the supply lands for GST purposes.
 *
 * The right terms are the ones the GST law uses, not "Indian" and "abroad":
 * a service supplied to a recipient outside India is an **export of services**,
 * zero-rated under LUT (IGST Act s.16); anything else is a **domestic supply**
 * and carries tax at the applicable rate.
 *
 * This drives the whole tax face of an invoice — the LUT disclaimer, the IGST
 * @ 0% line, and whether a GST rate is asked for at all — so it is captured on
 * the client and snapshotted onto every invoice.
 */
export type PlaceOfSupply = "export" | "domestic";

/**
 * How tax is presented on an invoice.
 *
 * The app records the treatment the user states; it does not decide which one
 * applies, and it does not compute liability (CLAUDE.md, Tax scope boundary).
 * `cgst_sgst` splits the stated rate into two equal halves — arithmetic, not a
 * judgement about intra- versus inter-state supply.
 */
export type TaxTreatment = "zero_rated_export" | "igst" | "cgst_sgst";

/** Hourly consultation versus a flat retainer. Decides how line items are entered and printed. */
export type BillingModel = "hourly" | "fixed";

/**
 * One retainer period, as a count of a unit.
 *
 * Expressed this way rather than as an enum of named frequencies so "every two
 * months" needs no new case: monthly is `{month, 1}`, quarterly `{month, 3}`,
 * fortnightly `{week, 2}`. The UI offers the usual names as shorthands.
 */
export interface BillingCycle {
  intervalUnit: "week" | "month";
  intervalCount: number;
}

export interface ClientBilling {
  model: BillingModel;
  /** Per hour, in the client's default currency. Used for `hourly`. */
  hourlyRate?: number;
  /** Per period, in the client's default currency. Used for `fixed`. */
  fixedAmount?: number;
  /** Only meaningful for `fixed`. */
  cycle?: BillingCycle;
  /** First day of the first billing period — periods are counted forward from here. */
  cycleAnchorDate?: string; // ISO 8601 date
  /** Generate a draft invoice automatically once a period has fully elapsed. */
  autoDraft: boolean;
  /**
   * Start date of the most recent period a draft was generated for, so opening
   * the app twice never produces two invoices for the same period.
   */
  lastDraftedPeriodStart?: string; // ISO 8601 date
}

/**
 * One piece of work inside a billed line — the row that appears in the invoice
 * annexure.
 *
 * A task is a record of what was done, not a price: it carries hours and no rate
 * of its own, because the rate belongs to the line it sits under. Splitting them
 * this way is what lets the invoice face stay a single defensible line while the
 * annexure carries the detail a client (or a scrutiny notice) actually asks for.
 *
 * The date is mandatory. An undated task is the same non-record as an undated
 * hourly line — see the `lineItems` refinement in the invoice form.
 */
export interface InvoiceTask {
  id: string;
  date: string; // ISO 8601 date
  description: string;
  hours: number;
}

export interface InvoiceLineItem {
  id: string;
  /**
   * Date the work was done. Hourly engagements bill date-wise, so the PDF
   * itemises consultations by date; blank on a flat retainer line.
   *
   * Left blank when the line carries `tasks` instead — the dates are then the
   * tasks' own, and a single date on the line would pick one of them arbitrarily.
   */
  date?: string; // ISO 8601 date
  description: string;
  /**
   * Hours when `unit` is "hours", otherwise a plain count.
   *
   * When `tasks` is present this is the sum of their hours, kept in step by the
   * form. Read it through `lineItemQuantity()` rather than directly: that helper
   * re-derives it from the tasks, so a stored total can never drift away from
   * the breakdown printed beneath it.
   */
  quantity: number;
  /** Rate per hour when `unit` is "hours", otherwise the flat amount. */
  unitPrice: number;
  unit: "hours" | "flat";
  /**
   * Itemised task breakdown for this line, printed as an annexure to the PDF.
   *
   * Absent or empty means the line stands on its own, which is every invoice
   * raised before annexures existed — so this stays optional rather than
   * defaulting to `[]`, and no migration is needed to read old invoices.
   */
  tasks?: InvoiceTask[];
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
  /** Export of services (zero-rated under LUT) or a domestic taxable supply. */
  placeOfSupply: PlaceOfSupply;
  /** The client's own GSTIN. Domestic supplies only — an overseas recipient has none. */
  gstin?: string;
  /** Indian state, for the record on a domestic invoice. */
  state?: string;
  /**
   * Where the service is actually delivered, when that is not the billing
   * address. Rule 46(o)/(r) requires it on an export invoice, and a US payables
   * desk routes on it.
   */
  deliveryAddress?: string;
}

export interface Client extends ClientSnapshot {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Soft-delete flag — clients referenced by existing invoices are never hard-deleted. */
  archived: boolean;

  billing: ClientBilling;

  /**
   * Defaults copied onto a domestic invoice, where they remain editable. The
   * app never derives these — 18% is offered because it is the common rate for
   * consultancy, not because the app decided it applies.
   */
  defaultGstRate?: number;
  defaultTaxTreatment?: TaxTreatment;
  /** Services Accounting Code, printed on a domestic tax invoice. */
  defaultSacCode?: string;
}

/** What kind of paper a client document is. Drives nothing but labelling and filtering. */
export type ClientDocumentKind = "nda" | "msa" | "sow" | "po" | "other";

/**
 * Terms pulled out of an uploaded contract.
 *
 * Every field is a *proposal*. The extractor reads the document's own text with
 * patterns — it has no understanding of the contract and no model behind it, so
 * an unusually worded clause is simply missed. Nothing here is written to a
 * client record without the user accepting it, and `warnings` says plainly what
 * could not be found.
 */
export interface ContractAnalysis {
  extractedAt: string; // ISO 8601
  /** Characters of text recovered — zero means a scanned/image PDF with nothing to read. */
  textLength: number;
  parties: string[];
  effectiveDate?: string; // ISO 8601 date
  endDate?: string; // ISO 8601 date
  noticePeriodDays?: number;
  /** How long confidentiality survives, in years — the term that matters on an NDA. */
  confidentialityYears?: number;
  governingLaw?: string;
  paymentTermsDays?: number;
  /** Money amounts found near rate/fee language, with the unit if one was stated. */
  rates: { label: string; amount: number; currency?: string; unit?: "hour" | "day" | "month" | "year" | "flat" }[];
  warnings: string[];
}

/**
 * A contract, NDA, or PO attached to a client.
 *
 * The file itself is held as a Blob in IndexedDB, which keeps it available
 * offline like everything else. It travels in the JSON backup base64-encoded —
 * that file is the only disaster-recovery path, and an NDA you cannot produce is
 * not much better than one you never signed — so uploads are size-capped.
 */
export interface ClientDocument {
  id: string;
  clientId: string;
  kind: ClientDocumentKind;
  fileName: string;
  mimeType: string;
  size: number; // bytes
  file: Blob;
  uploadedAt: string; // ISO 8601
  /** Undefined until the extractor has run, or if it could not read the file. */
  analysis?: ContractAnalysis;
  notes?: string;
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

  /**
   * Tax face of this invoice, snapshotted at creation alongside `clientSnapshot`
   * and frozen for the same reason: reclassifying a client later must not
   * retroactively change what an already-issued document said.
   */
  placeOfSupply: PlaceOfSupply;
  taxTreatment: TaxTreatment;
  /** Percent. Always 0 on an export invoice — zero-rated under LUT. */
  gstRate: number;
  /**
   * Services Accounting Code. Rule 46(g) wants it on an export too, not only on
   * a domestic supply — an invoice with no SAC is short a particular either way.
   */
  sacCode?: string;

  /**
   * The client's own purchase order or reference. Not an Indian requirement at
   * all; a US payables desk generally will not pay an invoice it cannot match to
   * a PO, so it travels on the face of the document.
   */
  poNumber?: string;
  /**
   * Rule 46(p) — whether tax on this supply is payable by the recipient under
   * reverse charge. Stored per invoice rather than assumed, because the answer
   * is a statement about the supply and the PDF prints it either way.
   */
  reverseCharge?: boolean;

  /** Copied from the client so the PDF knows whether to print hours or a flat fee. */
  billingModel: BillingModel;
  /** The retainer period this invoice covers, when it came from a billing cycle. */
  periodStart?: string; // ISO 8601 date
  periodEnd?: string; // ISO 8601 date
  /** True when the recurring generator raised this draft rather than a person. */
  autoGenerated?: boolean;

  /**
   * True on every export invoice — the LUT/IGST disclaimer is mandatory there
   * and printed verbatim. False on a domestic invoice, where the disclaimer
   * would be a false statement about the supply.
   */
  igstDisclaimerShown: boolean;

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
  /** Consultancy billed within India. Kept apart from foreign_income so the P&L never presents a domestic supply as an export. */
  | "domestic_income"
  /**
   * GST charged on a domestic invoice. A liability, not income — the entity is
   * collecting it on the government's behalf. Booking it here rather than into
   * income is bookkeeping, not a computation of what is owed.
   */
  | "gst_payable"
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
  | "invoice_auto_drafted"
  | "client_created"
  | "client_updated"
  | "client_archived"
  | "client_document_uploaded"
  | "client_document_deleted"
  | "expense_recorded"
  | "entity_profile_updated"
  | "currency_settings_changed"
  | "data_imported";

export type AuditEntityType =
  | "invoice"
  | "remittance"
  | "client"
  | "client_document"
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

/**
 * Dexie tables mirrored to Firestore for multi-device sync. `clientDocuments`
 * syncs metadata only — its `file` Blob is stripped before every push, since
 * Firestore documents cap out around 1MiB and are the wrong place for binary
 * attachments. Cross-device file transport is a separate, later piece (GCS).
 */
export const SYNCED_TABLES = [
  "currencies",
  "entityProfile",
  "clients",
  "clientDocuments",
  "invoices",
  "ledgerEntries",
  "auditLog",
  "counters",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Local outbox row (module: multi-device sync). `id` is `${table}:${docId}`
 * rather than a generated id — enqueueing the same row again before it drains
 * just refreshes `queuedAt` in place instead of piling up duplicate entries.
 * The row carries no payload: the drain worker reads the *current* Dexie row
 * for `(table, docId)` at push time, so a stale/partial value can never be
 * pushed, and a since-deleted row naturally becomes a Firestore delete.
 */
export interface SyncQueueEntry {
  id: string;
  table: SyncedTable;
  docId: string;
  queuedAt: string; // ISO 8601
}
