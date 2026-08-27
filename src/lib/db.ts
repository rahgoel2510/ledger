import Dexie, { type EntityTable } from "dexie";
import type {
  AuditLogEntry,
  Client,
  ClientDocument,
  Counter,
  Currency,
  EntityProfile,
  ExpenseCategory,
  ExpenseEntry,
  Invoice,
  LedgerEntry,
  Remittance,
  SyncQueueEntry,
} from "@/lib/types";
import { DEFAULT_CURRENCIES } from "@/lib/currencies";
import { REQUIRED_PROFILE_FIELDS, STARTER_ENTITY_PROFILE } from "@/lib/entity-profile";

/**
 * IndexedDB schema (Dexie). This is the app's source of truth — see
 * CLAUDE.md "Local persistence". GCS is a backup of PDFs/metadata only,
 * never a dependency for reads here.
 */
class VrikshaFXDB extends Dexie {
  currencies!: EntityTable<Currency, "code">;
  entityProfile!: EntityTable<EntityProfile, "id">;
  counters!: EntityTable<Counter, "key">;
  clients!: EntityTable<Client, "id">;
  clientDocuments!: EntityTable<ClientDocument, "id">;
  invoices!: EntityTable<Invoice, "id">;
  remittances!: EntityTable<Remittance, "id">;
  expenseCategories!: EntityTable<ExpenseCategory, "id">;
  expenseEntries!: EntityTable<ExpenseEntry, "id">;
  ledgerEntries!: EntityTable<LedgerEntry, "id">;
  auditLog!: EntityTable<AuditLogEntry, "id">;
  syncQueue!: EntityTable<SyncQueueEntry, "id">;

  constructor() {
    super("vrikshafx");

    this.version(1).stores({
      currencies: "code, isBase, active",
      clients: "id, name, country, archived",
      invoices: "id, serialNumber, financialYear, clientId, status, dueDate, invoiceDate",
      remittances: "id, invoiceId, receiptDate",
      expenseCategories: "id, active",
      expenseEntries: "id, categoryId, date",
      ledgerEntries: "id, [sourceType+sourceId], account, date",
      auditLog: "id, [entityType+entityId], actionType, timestamp",
    });

    // v2 adds the singleton entity profile (HUF particulars + bank wire details,
    // required on every invoice PDF) and the never-reused invoice sequence counters.
    this.version(2)
      .stores({
        entityProfile: "id",
        counters: "key",
      })
      .upgrade(async (tx) => {
        // `populate` only fires for a brand-new database, so an install upgrading
        // from v1 needs the singleton profile row created here instead.
        const profiles = tx.table<EntityProfile>("entityProfile");
        if ((await profiles.count()) === 0) await profiles.add(STARTER_ENTITY_PROFILE);

        // Existing installs predate `ExpenseCategory.ledgerAccount`; backfill so
        // expense postings have an account to target.
        await tx
          .table<ExpenseCategory>("expenseCategories")
          .toCollection()
          .modify((category) => {
            category.ledgerAccount ??= LEDGER_ACCOUNT_BY_SEED_CATEGORY[category.id] ?? "other_expense";
          });
      });

    // v3 adds contract/NDA attachments, per-client billing arrangements, and the
    // tax face of an invoice (place of supply, treatment, GST rate).
    //
    // Everything already in the database was raised under the only arrangement
    // the app supported: export of services, zero-rated under LUT, billed by the
    // hour. The backfill says exactly that rather than leaving fields undefined —
    // a stored invoice with no `placeOfSupply` would render a PDF with no tax
    // face at all, and this data has already gone to a client.
    this.version(3)
      .stores({
        clientDocuments: "id, clientId, kind, uploadedAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table<Client>("clients")
          .toCollection()
          .modify((client) => {
            client.placeOfSupply ??= "export";
            client.billing ??= { model: "hourly", autoDraft: false };
          });

        await tx
          .table<Invoice>("invoices")
          .toCollection()
          .modify((invoice) => {
            invoice.placeOfSupply ??= "export";
            invoice.taxTreatment ??= "zero_rated_export";
            invoice.gstRate ??= 0;
            invoice.billingModel ??= "hourly";
            invoice.igstDisclaimerShown ??= true;

            // The snapshot is what the PDF actually reads from, so it needs the
            // same classification — the live client row it was copied from may
            // since have been reclassified or archived.
            if (invoice.clientSnapshot) invoice.clientSnapshot.placeOfSupply ??= "export";

            for (const item of invoice.lineItems ?? []) {
              // Pre-v3 line items were an untyped quantity x unit price. Calling
              // them "hours" would invent a fact; "flat" preserves the arithmetic
              // and prints the same total.
              item.unit ??= "flat";
            }
          });
      });

    // v4 prefills the profile particulars an invoice PDF needs, so a database
    // that predates the starter profile is usable without a trip to Settings
    // first. No schema change — `stores` repeats v3 because Dexie requires a
    // version to declare one.
    //
    // Only blanks are touched. A particular already filled in is the user's, and
    // one they deliberately cleared stays cleared — this runs once per database,
    // so clearing a field after the upgrade is permanent.
    this.version(4)
      .stores({
        clientDocuments: "id, clientId, kind, uploadedAt",
      })
      .upgrade(async (tx) => {
        const profiles = tx.table<EntityProfile>("entityProfile");
        if ((await profiles.count()) === 0) {
          await profiles.add(STARTER_ENTITY_PROFILE);
          return;
        }
        await profiles.toCollection().modify((profile) => {
          for (const [key] of REQUIRED_PROFILE_FIELDS) {
            if (!String(profile[key] ?? "").trim()) {
              (profile[key] as string) = STARTER_ENTITY_PROFILE[key] as string;
            }
          }
        });
      });

    // v5 adds the local outbox for Firebase sync (multi-device). `id` is
    // `${table}:${docId}` rather than a random id — enqueueing the same row
    // twice before it drains overwrites the queued entry instead of piling up
    // duplicates, since a Dexie `put` on a repeated primary key just updates it.
    this.version(5).stores({
      syncQueue: "id, table, docId, queuedAt",
    });

    this.on("populate", () => this.seed());
  }

  private async seed() {
    await this.currencies.bulkAdd(DEFAULT_CURRENCIES);
    await this.entityProfile.add(STARTER_ENTITY_PROFILE);
    await this.expenseCategories.bulkAdd(SEED_EXPENSE_CATEGORIES);
  }
}

const LEDGER_ACCOUNT_BY_SEED_CATEGORY: Record<string, ExpenseCategory["ledgerAccount"]> = {
  "bank-charges": "bank_charges_expense",
  "software-subscriptions": "software_expense",
  "filing-fees": "filing_fees_expense",
};

const SEED_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "bank-charges", name: "Bank Charges", ledgerAccount: "bank_charges_expense", active: true },
  { id: "software-subscriptions", name: "Software Subscriptions", ledgerAccount: "software_expense", active: true },
  { id: "filing-fees", name: "Filing Fees", ledgerAccount: "filing_fees_expense", active: true },
];

export const db = new VrikshaFXDB();
