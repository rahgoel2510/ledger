import Dexie, { type EntityTable } from "dexie";
import type {
  AuditLogEntry,
  Client,
  Counter,
  Currency,
  EntityProfile,
  ExpenseCategory,
  ExpenseEntry,
  Invoice,
  LedgerEntry,
  Remittance,
} from "@/lib/types";
import { DEFAULT_CURRENCIES } from "@/lib/currencies";
import { EMPTY_ENTITY_PROFILE } from "@/lib/entity-profile";

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
  invoices!: EntityTable<Invoice, "id">;
  remittances!: EntityTable<Remittance, "id">;
  expenseCategories!: EntityTable<ExpenseCategory, "id">;
  expenseEntries!: EntityTable<ExpenseEntry, "id">;
  ledgerEntries!: EntityTable<LedgerEntry, "id">;
  auditLog!: EntityTable<AuditLogEntry, "id">;

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
        if ((await profiles.count()) === 0) await profiles.add(EMPTY_ENTITY_PROFILE);

        // Existing installs predate `ExpenseCategory.ledgerAccount`; backfill so
        // expense postings have an account to target.
        await tx
          .table<ExpenseCategory>("expenseCategories")
          .toCollection()
          .modify((category) => {
            category.ledgerAccount ??= LEDGER_ACCOUNT_BY_SEED_CATEGORY[category.id] ?? "other_expense";
          });
      });

    this.on("populate", () => this.seed());
  }

  private async seed() {
    await this.currencies.bulkAdd(DEFAULT_CURRENCIES);
    await this.entityProfile.add(EMPTY_ENTITY_PROFILE);
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
